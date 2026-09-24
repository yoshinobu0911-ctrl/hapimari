-- I29（2026-09-26）: ブロック照会の当事者限定と内部判定の private 分離の攻撃再現・回帰テスト
-- 実行: bash scripts/run_sql_tests.sh（期待 PASS 20件）
-- 全テストはトランザクション内で行い最後に rollback（DBを汚さない）
-- 見出しや説明文には判定語を入れない（ランナーは判定語を含む行を数えるため）
-- 例外を期待するケースは DO ブロック内で捕まえる（ON_ERROR_STOP=1 のため）。
-- forbidden とプロジェクトの権限エラーはどちらも 42501 なので、SQLERRM まで照合する。

\set QUIET on
\pset pager off

begin;

create temp table t_ids as
select
  (select id from profiles where gender = 'female' and status = 'active' and is_verified
     order by created_at, id limit 1) as f,
  (select id from profiles where gender = 'female' and status = 'active' and is_verified
     order by created_at, id offset 1 limit 1) as c,
  (select id from profiles where gender = 'male' and status = 'active' and is_verified
     order by created_at, id limit 1) as m,
  (select id from profiles where gender = 'male' and status = 'active' and is_verified
     order by created_at, id offset 1 limit 1) as m2;
select f as f_id, c as c_id, m as m_id, m2 as m2_id from t_ids \gset

-- 準備（postgres）: blocks(f→m)、マッチ fm / fm2、m の承認済み写真、3人の位置
delete from blocks where blocker in (:'f_id', :'m_id', :'m2_id', :'c_id')
                      or blocked in (:'f_id', :'m_id', :'m2_id', :'c_id');
insert into blocks (blocker, blocked) values (:'f_id', :'m_id');
insert into matches (user_a, user_b)
select least(f, x), greatest(f, x) from t_ids, unnest(array[m, m2]) as x
on conflict do nothing;
create temp table t_match as
select
  (select id from matches where user_a = least(:'f_id'::uuid, :'m_id'::uuid)
     and user_b = greatest(:'f_id'::uuid, :'m_id'::uuid)) as fm,
  (select id from matches where user_a = least(:'f_id'::uuid, :'m2_id'::uuid)
     and user_b = greatest(:'f_id'::uuid, :'m2_id'::uuid)) as fm2;
select fm as fm_id, fm2 as fm2_id from t_match \gset
insert into photo_reviews (path, user_id, status, reviewed_at)
values (:'m_id' || '/test_i29.jpg', :'m_id', 'approved', now())
on conflict (path) do update set status = 'approved', user_id = excluded.user_id;
insert into profile_locations (user_id, loc_lat, loc_lng)
select x, 35.68, 139.76 from t_ids, unnest(array[f, m, m2]) as x
on conflict (user_id) do update set loc_lat = excluded.loc_lat, loc_lng = excluded.loc_lng;
grant select on t_ids, t_match to authenticated, anon, service_role;
create temp table t_saved (k text primary key, v boolean);
grant select, insert on t_saved to authenticated, anon, service_role;

\echo '=== 当事者の判定 ==='
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when public.is_blocked_between(:'f_id', :'m_id') = true
            then 'PASS: C01 f から (f,m) は true' else 'FAIL: C01 f から (f,m) が true でない' end;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'m_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when public.is_blocked_between(:'m_id', :'f_id') = true
            then 'PASS: C02 m から (m,f) は true' else 'FAIL: C02 m から (m,f) が true でない' end;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when public.is_blocked_between(:'f_id', :'m2_id') = false
            then 'PASS: C03 f から (f,m2) は false' else 'FAIL: C03 f から (f,m2) が false でない' end;
reset role;

\echo '=== 第三者 c は他人同士の関係を知れない ==='
select set_config('request.jwt.claims', json_build_object('sub', :'c_id', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into t_saved values ('c04', public.is_blocked_between(:'f_id', :'m_id'));
select case when public.is_blocked_between(:'f_id', :'m_id') = false
             and public.is_blocked_between(:'f_id', :'m2_id') = false
            then 'PASS: C04 第三者には (f,m)(f,m2) とも false'
            else 'FAIL: C04 第三者がブロック関係を区別できる' end;
select case when public.is_match_blocked(:'fm_id') = false
             and public.is_match_blocked(:'fm2_id') = false
             and public.is_match_blocked(gen_random_uuid()) = false
            then 'PASS: C05 第三者には fm・fm2・不存在とも false'
            else 'FAIL: C05 第三者に is_match_blocked が true' end;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when public.is_match_blocked(:'fm_id') = true and public.is_match_blocked(:'fm2_id') = false
            then 'PASS: C06 当事者 f には fm=true・fm2=false'
            else 'FAIL: C06 当事者の is_match_blocked が想定外' end;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'m2_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when public.is_match_blocked(:'fm_id') = false
            then 'PASS: C07 別マッチの当事者 m2 には fm は false'
            else 'FAIL: C07 m2 が fm のブロックを知れる' end;
reset role;

\echo '=== service_role（Edge Function の内部呼び出し）は実判定を得る ==='
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into t_saved values
  ('sr_fm', public.is_blocked_between(:'f_id', :'m_id')),
  ('sr_fm2', public.is_blocked_between(:'f_id', :'m2_id')),
  ('sr_match', public.is_match_blocked(:'fm_id'));
reset role;
select set_config('request.jwt.claims', '', true);
select case when (select v from t_saved where k = 'sr_fm') = true
             and (select v from t_saved where k = 'sr_fm2') = false
             and (select v from t_saved where k = 'sr_match') = true
             and (select v from t_saved where k = 'sr_fm') = private.is_blocked_between(:'f_id', :'m_id')
             and (select v from t_saved where k = 'sr_fm2') = private.is_blocked_between(:'f_id', :'m2_id')
            then 'PASS: C08 service_role は true/false/true で private の結果と一致'
            else 'FAIL: C08 service_role の判定が想定外' end;

\echo '=== 身元なし・anon・private 直接呼び出しは拒否 ==='
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.is_blocked_between((select f from t_ids), (select m from t_ids));
    raise notice 'FAIL: C09 sub なしで is_blocked_between が値を返した';
  exception when others then
    if sqlerrm = 'forbidden' then raise notice 'PASS: C09 sub なしの is_blocked_between は forbidden';
    else raise notice 'FAIL: C09 想定外の例外 (%)', sqlerrm; end if;
  end;
end $$;
do $$ begin
  begin
    perform public.is_match_blocked((select fm from t_match));
    raise notice 'FAIL: C10 sub なしで is_match_blocked が値を返した';
  exception when others then
    if sqlerrm = 'forbidden' then raise notice 'PASS: C10 sub なしの is_match_blocked は forbidden';
    else raise notice 'FAIL: C10 想定外の例外 (%)', sqlerrm; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ begin
  begin
    perform public.is_blocked_between((select f from t_ids), (select m from t_ids));
    raise notice 'FAIL: C11 anon が is_blocked_between を実行できた';
  exception when others then
    if sqlerrm like 'permission denied for function%' then raise notice 'PASS: C11 anon は実行権なし';
    else raise notice 'FAIL: C11 想定外の例外 (%)', sqlerrm; end if;
  end;
end $$;
do $$ begin
  begin
    perform public.is_match_blocked((select fm from t_match));
    raise notice 'FAIL: C12 anon が is_match_blocked を実行できた';
  exception when others then
    if sqlerrm like 'permission denied for function%' then raise notice 'PASS: C12 anon は実行権なし';
    else raise notice 'FAIL: C12 想定外の例外 (%)', sqlerrm; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform private.is_blocked_between((select f from t_ids), (select m from t_ids));
    raise notice 'FAIL: C13 利用者が private を直接呼べた';
  exception when others then
    if sqlerrm like 'permission denied for schema private%' then
      raise notice 'PASS: C13 利用者は private を参照できない';
    else raise notice 'FAIL: C13 想定外の例外 (%)', sqlerrm; end if;
  end;
end $$;
reset role;

\echo '=== 内部経路がブロックに反応し、ブロックの無い組では動く ==='
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into t_saved values ('c14_f', public.is_photo_of_profile((select m from t_ids) || '/test_i29.jpg', (select m from t_ids)));
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'c_id', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into t_saved values ('c14_c', public.is_photo_of_profile((select m from t_ids) || '/test_i29.jpg', (select m from t_ids)));
reset role;
select case when (select v from t_saved where k = 'c14_f') = false and (select v from t_saved where k = 'c14_c') = true
            then 'PASS: C14 写真はブロック相手 f には false・第三者 c には true'
            else 'FAIL: C14 写真の判定が想定外' end;
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.get_date_status((select fm from t_match));
    raise notice 'FAIL: C15 ブロック済みマッチでデート状態を取得できた';
  exception when others then
    if sqlerrm = 'blocked' then raise notice 'PASS: C15 get_date_status はブロックで拒否';
    else raise notice 'FAIL: C15 想定外の例外 (%)', sqlerrm; end if;
  end;
end $$;
select case when (select array_agg(user_id) from public.get_profile_distances(array[(select m from t_ids), (select m2 from t_ids)]))
                 = array[(select m2 from t_ids)]
            then 'PASS: C16 測距はブロック相手を除き m2 だけ返す'
            else 'FAIL: C16 測距の結果が想定外' end;
select case when not exists (select 1 from profiles_public where id = (select m from t_ids))
             and exists (select 1 from profiles_public where id = (select m2 from t_ids))
            then 'PASS: C17 profiles_public に m は出ず m2 は出る'
            else 'FAIL: C17 profiles_public の絞り込みが想定外' end;
do $$ begin
  begin
    insert into messages (match_id, sender, body)
    values ((select fm from t_match), (select f from t_ids), 'I29 blocked');
    raise notice 'FAIL: C18 ブロック済みマッチへ送信できた';
  exception when others then
    if sqlerrm like 'new row violates row-level security policy%' then
      raise notice 'PASS: C18 ブロック済みマッチへの送信は RLS で拒否';
    else raise notice 'FAIL: C18 想定外の例外 (%)', sqlerrm; end if;
  end;
end $$;
do $$ begin
  begin
    insert into messages (match_id, sender, body)
    values ((select fm2 from t_match), (select f from t_ids), 'I29 ok');
    raise notice 'PASS: C19 ブロックの無いマッチへは送信できる';
  exception when others then
    raise notice 'FAIL: C19 送信できない (%)', sqlerrm;
  end;
end $$;
reset role;

\echo '=== ブロックの有無で第三者の結果が変わらない ==='
select set_config('request.jwt.claims', '', true);
delete from blocks where blocker = :'f_id' and blocked = :'m_id';
select set_config('request.jwt.claims', json_build_object('sub', :'c_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when public.is_blocked_between(:'f_id', :'m_id') = false
             and public.is_blocked_between(:'f_id', :'m_id') = (select v from t_saved where k = 'c04')
            then 'PASS: C20 ブロック削除後も第三者の結果は削除前と同じ false'
            else 'FAIL: C20 第三者の結果がブロックの有無で変わる' end;
reset role;

rollback;
