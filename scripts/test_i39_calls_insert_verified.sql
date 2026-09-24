-- I39（2026-09-26）: calls の INSERT に本人確認条件を追加したことの回帰・攻撃再現テスト
-- 実行: bash scripts/run_sql_tests.sh（期待 PASS 6件）
-- 全テストはトランザクション内で行い最後に rollback（DBを汚さない）
-- 見出しや説明文には判定語を入れない（ランナーは判定語を含む行を数えるため）

\set QUIET on
\pset pager off

begin;

create temp table t_ids as
select
  (select id from profiles where gender = 'female' and status = 'active' and is_verified
     order by created_at, id limit 1) as f,
  (select id from profiles where gender = 'male' and status = 'active' and is_verified
     order by created_at, id limit 1) as m,
  (select id from profiles where gender = 'male' and status = 'active' and is_verified
     order by created_at, id offset 1 limit 1) as c;
select f as f_id, m as m_id, c as c_id from t_ids \gset
delete from blocks where (blocker = :'f_id' and blocked = :'m_id') or (blocker = :'m_id' and blocked = :'f_id');
insert into matches (user_a, user_b)
select least(:'f_id'::uuid, :'m_id'::uuid), greatest(:'f_id'::uuid, :'m_id'::uuid) on conflict do nothing;
create temp table t_match as
select id from matches where user_a = least(:'f_id'::uuid, :'m_id'::uuid)
  and user_b = greatest(:'f_id'::uuid, :'m_id'::uuid);
grant select on t_ids, t_match to authenticated;

-- 期待する例外（RLS 違反）かどうかを判定する補助
create or replace function pg_temp.try_insert_call() returns text language plpgsql as $$
begin
  insert into calls (match_id, started_at) values ((select id from t_match), now());
  return 'inserted';
exception when others then
  if sqlerrm like 'new row violates row-level security policy%' then return 'rls'; end if;
  return 'other: ' || sqlerrm;
end $$;

\echo '=== 本人確認済みの当事者は記録を作れる ==='
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when pg_temp.try_insert_call() = 'inserted'
            then 'PASS: #1 本人確認済みの当事者は calls を作成できる'
            else 'FAIL: #1 正規の記録が作れない' end;
reset role;

\echo '=== 本人確認前の当事者は拒否 ==='
select set_config('request.jwt.claims', '', true);
update profiles set is_verified = false where id = :'f_id';
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when pg_temp.try_insert_call() = 'rls'
            then 'PASS: #2 本人確認前の当事者は RLS で拒否'
            else 'FAIL: #2 本人確認前でも作成できる' end;
reset role;
select set_config('request.jwt.claims', '', true);
update profiles set is_verified = true where id = :'f_id';

\echo '=== 従来の拒否条件は維持 ==='
select set_config('request.jwt.claims', json_build_object('sub', :'c_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when pg_temp.try_insert_call() = 'rls'
            then 'PASS: #3 当事者でない利用者は拒否'
            else 'FAIL: #3 非当事者が作成できる' end;
reset role;
select set_config('request.jwt.claims', '', true);
insert into blocks (blocker, blocked) values (:'m_id', :'f_id');
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when pg_temp.try_insert_call() = 'rls'
            then 'PASS: #4 ブロック関係のあるマッチは拒否'
            else 'FAIL: #4 ブロック済みで作成できる' end;
reset role;
select set_config('request.jwt.claims', '', true);
delete from blocks where blocker = :'m_id' and blocked = :'f_id';
update profiles set status = 'suspended' where id = :'f_id';
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when pg_temp.try_insert_call() = 'rls'
            then 'PASS: #5 凍結中の当事者は拒否'
            else 'FAIL: #5 凍結中でも作成できる' end;
reset role;
select set_config('request.jwt.claims', '', true);
update profiles set status = 'active' where id = :'f_id';

\echo '=== ポリシーの形 ==='
select case
  when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'calls'
          and cmd in ('INSERT', 'ALL')) = 1
   and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calls'
          and cmd = 'INSERT' and with_check like '%is_verified%' and with_check like '%is_match_blocked%'
          and with_check like '%is_caller_active%' and with_check like '%is_match_participant%')
  then 'PASS: #6 calls の INSERT ポリシーは1本で本人確認・在籍・非ブロック・当事者を含む'
  else 'FAIL: #6 calls の INSERT ポリシーが想定外' end;

rollback;
