-- I08（2026-09-26）: get_my_latest_messages() の攻撃再現・回帰テスト
-- 実行: bash scripts/run_sql_tests.sh（期待 PASS 11件）
-- 全テストはトランザクション内で行い最後に rollback（DBを汚さない）
-- 注意: 前提データの投入は最初の set_config('request.jwt.claims', …) より前に行う
--       （クレームが残ると _enforce_message_entitlement が sender_mismatch を出すため）

\set QUIET on
\pset pager off

begin;

create temp table t_ids as
select
  (select id from profiles where gender = 'female' and status = 'active' and is_verified
     order by created_at, id limit 1) as f,
  (select id from profiles where gender = 'male' and status = 'active'
     order by created_at, id limit 1) as m,
  (select id from profiles where gender = 'male' and status = 'active'
     order by created_at, id offset 1 limit 1) as m2,
  (select id from profiles where gender = 'male' and status = 'active'
     order by created_at, id offset 2 limit 1) as m3;
select f as f_id, m as m_id, m2 as m2_id, m3 as m3_id from t_ids \gset

-- マッチ X=(f,m) / Y=(f,m2) / Z=(f,m3)。user_a < user_b に揃える
insert into matches (user_a, user_b)
select least(f, x), greatest(f, x) from t_ids, unnest(array[m, m2, m3]) as x
on conflict do nothing;
create temp table t_match as
select
  (select id from matches where user_a = least(:'f_id'::uuid, :'m_id'::uuid)
     and user_b = greatest(:'f_id'::uuid, :'m_id'::uuid)) as x,
  (select id from matches where user_a = least(:'f_id'::uuid, :'m2_id'::uuid)
     and user_b = greatest(:'f_id'::uuid, :'m2_id'::uuid)) as y,
  (select id from matches where user_a = least(:'f_id'::uuid, :'m3_id'::uuid)
     and user_b = greatest(:'f_id'::uuid, :'m3_id'::uuid)) as z;
select x as x_id, y as y_id, z as z_id from t_match \gset

delete from messages where match_id in (:'x_id', :'y_id', :'z_id');
-- Y: 1日前に1件
insert into messages (match_id, sender, body, created_at)
values (:'y_id', :'m2_id', 'I08-Y-latest', now() - interval '1 day');
-- X: 新しい発言を1100件（i=1 が最新）
insert into messages (match_id, sender, body, created_at)
select :'x_id', :'m_id',
       case when i = 1 then 'I08-X-latest' else 'I08-X-' || i end,
       now() - i * interval '1 second'
from generate_series(1, 1100) as i;

\echo '--- 前提: f の全マッチを新しい順に並べたときの Y の最新の順位（1001以上なら旧方式で欠落する） ---'
select 'NOTE: Y の最新は全体の ' || rnk || ' 位' from (
  select msg.match_id, row_number() over (order by msg.created_at desc) as rnk
  from messages msg join matches mt on mt.id = msg.match_id
  where mt.user_a = :'f_id' or mt.user_b = :'f_id'
) r where match_id = :'y_id' order by rnk limit 1;

create temp table t_expected as
select count(distinct mt.id) as n
from matches mt join messages msg on msg.match_id = mt.id
where mt.user_a = :'f_id' or mt.user_b = :'f_id';
grant select on t_expected to authenticated;

\echo '=== f の視点 ==='
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table t_f as select * from public.get_my_latest_messages();
select case when exists (select 1 from t_f where match_id = :'y_id' and body = 'I08-Y-latest')
  then 'PASS: #1 1000件超の他会話があっても Y の最新が返る'
  else 'FAIL: #1 Y の最新が返らない' end;
select case when exists (select 1 from t_f where match_id = :'x_id' and body = 'I08-X-latest')
  then 'PASS: #2 X は最新の1件が返る'
  else 'FAIL: #2 X の最新が違う' end;
select case when (select count(*) from t_f) = (select count(distinct match_id) from t_f)
            and (select count(*) from t_f) = (select n from t_expected)
  then 'PASS: #3 1マッチ1行で、メッセージのある全マッチを含む'
  else 'FAIL: #3 行数が想定と違う (' || (select count(*) from t_f) || ' / 期待 '
       || (select n from t_expected) || ')' end;
select case when not exists (select 1 from t_f where match_id = :'z_id')
  then 'PASS: #4 メッセージ0件の Z は返らない'
  else 'FAIL: #4 Z が返った' end;
reset role;

\echo '=== 攻撃: 当事者でないマッチは取れない ==='
select set_config('request.jwt.claims', json_build_object('sub', :'m_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case
  when exists (select 1 from public.get_my_latest_messages()
               where match_id = :'x_id' and body = 'I08-X-latest')
   and not exists (select 1 from public.get_my_latest_messages() where match_id = :'y_id')
  then 'PASS: #5 m は自分の X だけ取れ、Y は取れない'
  else 'FAIL: #5 m の結果が想定と違う' end;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'m2_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case
  when exists (select 1 from public.get_my_latest_messages()
               where match_id = :'y_id' and body = 'I08-Y-latest')
   and not exists (select 1 from public.get_my_latest_messages() where match_id = :'x_id')
  then 'PASS: #6 m2 は自分の Y だけ取れ、X は取れない'
  else 'FAIL: #6 m2 の結果が想定と違う' end;
reset role;

\echo '=== anon は実行できない ==='
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ begin
  begin
    perform public.get_my_latest_messages();
    raise notice 'FAIL: #7 anon が実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: #7 anon は permission denied';
    when others then
      raise notice 'FAIL?: #7 想定外の拒否理由 (%)', sqlerrm;
  end;
end $$;
reset role;

\echo '=== 定義と権限 ==='
select case
  when not has_function_privilege('anon', 'public.get_my_latest_messages()', 'execute')
   and has_function_privilege('authenticated', 'public.get_my_latest_messages()', 'execute')
   and has_function_privilege('service_role', 'public.get_my_latest_messages()', 'execute')
   and (select proacl::text from pg_proc
        where oid = 'public.get_my_latest_messages()'::regprocedure) not like '%{=X/%'
   and (select proacl::text from pg_proc
        where oid = 'public.get_my_latest_messages()'::regprocedure) not like '%,=X/%'
  then 'PASS: #8 ACL は authenticated/service_role のみ（anon・PUBLIC なし）'
  else 'FAIL: #8 ACL が想定と違う' end;
select case
  when p.prosecdef = false and 'search_path=public' = any(p.proconfig)
  then 'PASS: #9 SECURITY INVOKER かつ search_path=public'
  else 'FAIL: #9 定義が想定と違う' end
from pg_proc p where p.oid = 'public.get_my_latest_messages()'::regprocedure;

\echo '=== ブロック後も自分のマッチの最新は返る（現状維持） ==='
insert into blocks (blocker, blocked) values (:'f_id', :'m2_id') on conflict do nothing;
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when exists (select 1 from public.get_my_latest_messages() where match_id = :'y_id')
  then 'PASS: #10 ブロック後も Y の最新が返る'
  else 'FAIL: #10 ブロック後に Y が返らない' end;
reset role;

\echo '=== RLS を素通りする service_role でも当事者条件で0行 ==='
select set_config('request.jwt.claims', '', true);
set local role service_role;
select case when (select count(*) from public.get_my_latest_messages()) = 0
  then 'PASS: #11 クレーム無しの service_role は0行（WHERE の当事者条件が効いている）'
  else 'FAIL: #11 service_role に行が返った' end;
reset role;

rollback;
