-- ============================================================
-- M7.3 決済の取りこぼし・二重契約・退会時の課金継続を防ぐ（2026-09-24）
--
-- 背景: PR#1 レビュー統合表 I06/I07/I23/I24/I25/I26/I34。
--   設計: docs/design/2026-09-24_決済修正設計提案.md §8-9（オーナー承認 Q1=A'/Q2=A）
--
-- このmigrationが足すのは4列だけ（新規テーブルは作らない）:
--   stripe_events.processed_at / needs_review
--   subscriptions.pending_checkout_session_id / last_event_created
-- ============================================================

alter table public.stripe_events
  add column if not exists processed_at timestamptz,
  add column if not exists needs_review boolean not null default false;
comment on column public.stripe_events.processed_at is
  '課金状態への反映が完了した時刻。NULLは未処理（Stripeの再送で再処理してよい）。
   旧実装は insert 成功だけを冪等性の根拠にし、失敗時に行を delete していたため、
   輻輳配送（Stripeの再送）時に記録が残らないまま処理済み扱いになる穴があった';
comment on column public.stripe_events.needs_review is
  '自動判断できなかった通知（複数有効契約・対応不明・照合失敗の恒久化）。運営が手動確認するまでtrue';

alter table public.subscriptions
  add column if not exists pending_checkout_session_id text,
  add column if not exists last_event_created bigint;
comment on column public.subscriptions.pending_checkout_session_id is
  '発行済みで結果未確定のCheckout Session ID、または予約中を示す一時トークン（"reserving:"始まり）。
   二重発行の防止に使う。完了・失効・予約タイムアウトで必ずNULLに戻す';
comment on column public.subscriptions.last_event_created is
  '反映済み最新イベントのStripe event.created（秒）。契約IDが変わったらNULLに戻す';

-- 権限は既存方針を継承。両テーブルとも既に authenticated/anon から revoke all 済みのため、
-- 列を足すだけで追加のGRANT操作は不要（利用者からは引き続き見えない）。

-- ------------------------------------------------------------
-- 退会ガード（I25・Q2=A「先に解約し、契約終了後に退会」）
-- ------------------------------------------------------------
create or replace function public.withdraw_account()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  sub record;
begin
  select status, pending_checkout_session_id into sub
    from subscriptions where user_id = auth.uid();

  if sub.status in ('active', 'trialing', 'past_due', 'incomplete', 'unpaid', 'paused') then
    raise exception 'subscription_active';
  end if;
  if sub.pending_checkout_session_id is not null then
    raise exception 'checkout_pending';
  end if;

  update profiles set status = 'withdrawn', withdrawn_at = now()
  where id = auth.uid() and status <> 'withdrawn';
  if not found then
    raise exception 'not_registered';
  end if;
  perform public._record_withdrawal(auth.uid(), false, null);
  return jsonb_build_object('ok', true);
end;
$$;
-- 権限は既存のまま（本人向けRPCとして authenticated に既存GRANTあり）。ここでは差し替えのみ。

-- ------------------------------------------------------------
-- 期限掃除からStripe未確認の status 書き換えを外す（I25の随伴修正）
--
-- 旧実装は current_period_end 経過から3日後に status を 'canceled' へ強制していたが、
-- これは「Stripeが確認していない終了」をDBに書き込む行為であり、上記の退会ガード
-- （status='canceled' は退会許可）と組み合わせると、実際は past_due で契約継続中でも
-- 3日で退会できてしまう抜け道になっていた（設計提案§9.5-2で発見）。
-- 利用可否の判定（is_subscription_active）は current_period_end を直接見ているため、
-- status を書き換えなくても「使えなくなる」動作は変わらない。
-- status の真実は Stripe Webhook（syncSubscription）と stripe-cancel の照会同期
-- （{refresh:true}、9.4）だけが更新する。
-- ------------------------------------------------------------
create or replace function public.expire_stale_subscriptions()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  n integer;
begin
  -- Webhook取りこぼし対策: フラグと実態のズレを一括で直す（戻り値は補正した件数）
  update profiles p
     set subscription_active = public.is_subscription_active(p.id)
   where p.subscription_active is distinct from public.is_subscription_active(p.id);
  get diagnostics n = row_count;

  return n;
end $$;
-- revoke/grant は既存のまま（service_role限定）。定義の差し替えのみ。
