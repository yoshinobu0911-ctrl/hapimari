-- M7.3 決済修正（退会ガード・期限掃除の整合）の検証
-- 実行: docker exec -i supabase_db_hapimari psql -U postgres -d postgres < scripts/test_m73_payment_reconciliation.sql
-- 全テストはトランザクション内で行い最後に rollback（DBを汚さない）
-- 対象: docs/design/2026-09-24_決済修正設計提案.md §9.1・§9.5

\set QUIET on
\pset pager off
begin;

create temp table t as
select (select id from profiles where gender='male' and status='active' order by created_at limit 1) as u;
select u as uid from t \gset

-- この行に既存の契約データが無いことを前提にしない。まず確実にクリアしてから各ケースを作る
delete from subscriptions where user_id = :'uid'::uuid;

\echo ''
\echo '################ 1. status別の退会ガード（I25・Q2=A） ################'

-- T1: active な契約が残っている間は退会できない
insert into subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end)
values (:'uid'::uuid, 'cus_test_m73', 'sub_test_m73', 'male_3m', 'active', now() + interval '30 days');

select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role','authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform public.withdraw_account();
  raise exception 'T1_NO_EXCEPTION';
exception
  when others then
    if sqlerrm = 'subscription_active' then
      raise notice 'PASS: T1 active中は subscription_active で拒否された';
    else
      raise notice 'FAIL: T1 想定外の結果 %', sqlerrm;
    end if;
end $$;
reset role;
select status from profiles where id = :'uid'::uuid \gset t1_
select case when :'t1_status' = 'active' then 'PASS: T1-b 拒否後もprofilesは active のまま' else 'FAIL' end as "T1-b";

-- T2: past_due でも同様に拒否される（active/trialing以外の稼働ステータスの代表として確認）
update subscriptions set status = 'past_due' where user_id = :'uid'::uuid;
set local role authenticated;
do $$
begin
  perform public.withdraw_account();
  raise notice 'FAIL: T2 例外が発生しなかった';
exception
  when others then
    if sqlerrm = 'subscription_active' then
      raise notice 'PASS: T2 past_due も subscription_active で拒否された';
    else
      raise notice 'FAIL: T2 想定外の結果 %', sqlerrm;
    end if;
end $$;
reset role;

\echo ''
\echo '################ 2. 予約中Checkoutの退会ガード ################'

-- T3: statusはcanceled(退会許可対象)でも、pending_checkout_session_idが残っていれば拒否
update subscriptions set status = 'canceled', pending_checkout_session_id = 'cs_test_pending'
where user_id = :'uid'::uuid;
set local role authenticated;
do $$
begin
  perform public.withdraw_account();
  raise notice 'FAIL: T3 例外が発生しなかった';
exception
  when others then
    if sqlerrm = 'checkout_pending' then
      raise notice 'PASS: T3 pending中は checkout_pending で拒否された';
    else
      raise notice 'FAIL: T3 想定外の結果 %', sqlerrm;
    end if;
end $$;
reset role;

\echo ''
\echo '################ 3. 退会できるケース ################'

-- T4: status=canceled かつ pending が無ければ退会できる
update subscriptions set pending_checkout_session_id = null where user_id = :'uid'::uuid;
set local role authenticated;
select withdraw_account() as "T4_result";
reset role;
select case when status = 'withdrawn' then 'PASS: T4 canceled+pendingなしは退会できた' else 'FAIL: ' || status end as "T4"
from profiles where id = :'uid'::uuid;

-- 後続のT5用に戻す（退会前の状態へ）
update profiles set status = 'active', withdrawn_at = null where id = :'uid'::uuid;
delete from identity_ledger where email_hash = public._email_hash_of(:'uid'::uuid);

-- T5: subscriptions 行が一切無くても退会できる（課金履歴が無い会員）
delete from subscriptions where user_id = :'uid'::uuid;
set local role authenticated;
select withdraw_account() as "T5_result";
reset role;
select case when status = 'withdrawn' then 'PASS: T5 契約行が無い会員は退会できた' else 'FAIL: ' || status end as "T5"
from profiles where id = :'uid'::uuid;

-- 後片付け（トランザクション末尾のrollbackで元に戻るが、以降のクエリのため明示的に戻す）
update profiles set status = 'active', withdrawn_at = null where id = :'uid'::uuid;
delete from identity_ledger where email_hash = public._email_hash_of(:'uid'::uuid);

\echo ''
\echo '################ 4. 期限掃除がStripe未確認のstatusを書き換えないこと（§9.5-2） ################'

-- T6: current_period_end が3日以上前の active 行を作り、expire_stale_subscriptions を実行しても
--     status は active のまま変わらないこと（旧実装はここを canceled に強制していた）
insert into subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end)
values (:'uid'::uuid, 'cus_test_m73_expired', 'sub_test_m73_expired', 'male_1m', 'active', now() - interval '10 days')
on conflict (user_id) do update set
  stripe_customer_id = excluded.stripe_customer_id,
  stripe_subscription_id = excluded.stripe_subscription_id,
  status = excluded.status,
  current_period_end = excluded.current_period_end;

select public.expire_stale_subscriptions() as "T6_run";

select case when status = 'active' then 'PASS: T6-a 期限切れでもstatusはactiveのまま（Stripe未確認のため書き換えない）'
            else 'FAIL: status=' || status end as "T6-a"
from subscriptions where user_id = :'uid'::uuid;

-- T6-b: それでも is_subscription_active() は正しく false を返す（current_period_end経過を直接見るため）
select case when public.is_subscription_active(:'uid'::uuid) = false
            then 'PASS: T6-b 期限切れは is_subscription_active=false のまま（statusに依存しない）'
            else 'FAIL' end as "T6-b";

-- T6-c: profiles.subscription_active もこの関数でtrueからfalseへ補正される
update profiles set subscription_active = true where id = :'uid'::uuid;
select public.expire_stale_subscriptions() as "T6-c_run";
select case when subscription_active = false then 'PASS: T6-c profiles.subscription_activeがfalseへ補正された'
            else 'FAIL' end as "T6-c"
from profiles where id = :'uid'::uuid;

rollback;
