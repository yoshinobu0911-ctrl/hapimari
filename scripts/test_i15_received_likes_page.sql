-- I15（2026-09-26）: get_received_likes_page() の回帰・攻撃再現テスト
-- 実行: bash scripts/run_sql_tests.sh（期待 PASS 13件）
-- 全テストはトランザクション内で行い最後に rollback（DBを汚さない）
-- 見出しや説明文には判定語を入れない（ランナーは判定語を含む行を数えるため）
-- 受信いいねは送り主ごとに1件（unique）なので、送り主の利用者をトランザクション内で大量に作る。

\set QUIET on
\pset pager off

begin;

create temp table t_ids as
select
  (select id from profiles where gender = 'female' and status = 'active' and is_verified
     order by created_at, id limit 1) as f,
  (select id from profiles where gender = 'male' and status = 'active' and is_verified
     order by created_at, id limit 1) as mr,
  (select id from profiles where gender = 'male' and status = 'active' and is_verified
     order by created_at, id offset 1 limit 1) as m2,
  ((now() at time zone 'Asia/Tokyo')::date) as today;
select f as f_id, mr as mr_id, m2 as m2_id from t_ids \gset
grant select on t_ids to authenticated, anon;

-- 送り主: 男性 250人（女性受信者 f 向け）、女性 1100人（男性受信者 mr 向け）
create temp table t_senders as
select i, gen_random_uuid() as id, case when i <= 250 then 'male' else 'female' end as gender
from generate_series(1, 1350) as i;
insert into auth.users (id) select id from t_senders;
insert into profiles (id, nickname, gender, birth_date, prefecture, marital_history)
select s.id, 'i15-' || s.i, s.gender, t.birth_date, t.prefecture, t.marital_history
from t_senders s cross join (select birth_date, prefecture, marital_history from profiles
                             where id = :'f_id') t;
grant select on t_senders to authenticated;

delete from likes where to_user in (:'f_id', :'mr_id');

-- 全ページを取り切る補助（呼び出し元の権限で動く）
create temp table t_pages (seq serial, like_id uuid, from_user uuid, created_at timestamptz,
                           display_date date, carried integer);
grant select, insert, delete on t_pages to authenticated;
grant usage on sequence t_pages_seq_seq to authenticated;
create or replace function pg_temp.fetch_all(p_limit integer) returns void language plpgsql as $$
declare c_at timestamptz; c_id uuid; n integer;
begin
  delete from t_pages;
  loop
    insert into t_pages (like_id, from_user, created_at, display_date, carried)
    select g.like_id, g.from_user, g.created_at, g.display_date, g.carried_over_count
    from public.get_received_likes_page(c_at, c_id, p_limit) g;
    get diagnostics n = row_count;
    exit when n < p_limit;
    select t.created_at, t.like_id into c_at, c_id from t_pages t order by t.seq desc limit 1;
  end loop;
end $$;

\echo '=== 女性受信者: 同じ日に250件 → 100件表示・150件繰越 ==='
insert into likes (from_user, to_user, created_at)
select s.id, :'f_id',
       ((select today from t_ids)::timestamp + s.i * interval '1 second') at time zone 'Asia/Tokyo'
from t_senders s where s.i <= 250;
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.fetch_all(50);
select case when (select count(*) from t_pages) = 100 and (select min(carried) from t_pages) = 150
             and (select max(carried) from t_pages) = 150
            then 'PASS: #1 1日100件まで表示し、残り150件は繰越件数として返る'
            else 'FAIL: #1 表示 ' || (select count(*) from t_pages) || ' 件 / 繰越 '
                 || coalesce((select max(carried) from t_pages), -1) end;
select case when (select array_agg(s.i order by p.seq) from t_pages p join t_senders s on s.id = p.from_user)
                 = (select array_agg(g order by g desc) from generate_series(1, 100) g)
            then 'PASS: #2 表示されるのは古い方の100件で、新しい順に並ぶ'
            else 'FAIL: #2 表示対象か順序が想定と違う' end;
reset role;

\echo '=== 割当の前に、ブロック相手・退会者を除外する ==='
select set_config('request.jwt.claims', '', true);
insert into blocks (blocker, blocked) select :'f_id', id from t_senders where i = 1;
update profiles set status = 'withdrawn' where id = (select id from t_senders where i = 2);
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.fetch_all(50);
select case when (select count(*) from t_pages) = 100 and (select max(carried) from t_pages) = 148
             and (select min(s.i) from t_pages p join t_senders s on s.id = p.from_user) = 3
             and (select max(s.i) from t_pages p join t_senders s on s.id = p.from_user) = 102
            then 'PASS: #3 ブロック相手と退会者は除外され、繰り上がった100件が表示される'
            else 'FAIL: #3 除外が割当の前に行われていない' end;
reset role;

\echo '=== 日をまたぐ繰越（2日前120件・前日90件・当日10件） ==='
select set_config('request.jwt.claims', '', true);
delete from blocks where blocker = :'f_id';
update profiles set status = 'active' where id = (select id from t_senders where i = 2);
delete from likes where to_user = :'f_id';
insert into likes (from_user, to_user, created_at)
select s.id, :'f_id',
       (((select today from t_ids) - case when s.i <= 120 then 2 when s.i <= 210 then 1 else 0 end)::timestamp
        + interval '1 hour' + s.i * interval '1 second') at time zone 'Asia/Tokyo'
from t_senders s where s.i <= 220;
select set_config('request.jwt.claims', json_build_object('sub', :'f_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.fetch_all(100);
select case when (select count(*) from t_pages) = 220 and (select max(carried) from t_pages) = 0
             and (select count(*) from t_pages where display_date = (select today from t_ids) - 2) = 100
             and (select count(*) from t_pages where display_date = (select today from t_ids) - 1) = 100
             and (select count(*) from t_pages where display_date = (select today from t_ids)) = 20
            then 'PASS: #4 2日前100・前日100・当日20に割り当たり、繰越は0'
            else 'FAIL: #4 日ごとの割当が想定と違う' end;
select case when not exists (
              select 1 from t_pages p join t_senders s on s.id = p.from_user
              where s.i between 121 and 130 and p.display_date <> (select today from t_ids) - 1)
             and not exists (
              select 1 from t_pages p join t_senders s on s.id = p.from_user
              where s.i between 201 and 210 and p.display_date <> (select today from t_ids))
            then 'PASS: #5 前日分の先頭は前日に、前日分の末尾10件は当日へ繰り越される'
            else 'FAIL: #5 繰越先の日付が想定と違う' end;
reset role;

\echo '=== 男性受信者: 上限なし・1100件をページで最後まで取れる ==='
select set_config('request.jwt.claims', '', true);
insert into likes (from_user, to_user, created_at)
select s.id, :'mr_id', now() - (s.i - 250) * interval '1 minute'
from t_senders s where s.i > 250;
select set_config('request.jwt.claims', json_build_object('sub', :'mr_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.fetch_all(50);
select case when (select count(*) from t_pages) = 1100 and (select count(distinct like_id) from t_pages) = 1100
             and (select max(carried) from t_pages) = 0
            then 'PASS: #6 1100件すべてに重複なく到達し、繰越は0'
            else 'FAIL: #6 取得 ' || (select count(*) from t_pages) || ' 件 / 重複なし '
                 || (select count(distinct like_id) from t_pages) end;
select case when not exists (
              select 1 from t_pages a join t_pages b on b.seq = a.seq + 1
              where (a.created_at, a.like_id) <= (b.created_at, b.like_id))
             and (select s.i from t_pages p join t_senders s on s.id = p.from_user order by p.seq limit 1) = 251
            then 'PASS: #7 全ページを通して新しい順で、1ページ目の先頭が最新'
            else 'FAIL: #7 並び順が想定と違う' end;
select case when (select count(*) from public.get_received_likes_page(null, null, 1000)) = 100
             and (select count(*) from public.get_received_likes_page(null, null, 0)) = 1
            then 'PASS: #8 1回の件数は 1〜100 に丸められる'
            else 'FAIL: #8 件数の丸めが想定と違う' end;
reset role;

\echo '=== 他人の受信いいねは取れない ==='
select set_config('request.jwt.claims', json_build_object('sub', :'m2_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when not exists (
              select 1 from public.get_received_likes_page(null, null, 100) g
              where g.like_id in (select l.id from likes l where l.to_user in ((select f from t_ids), (select mr from t_ids))))
            then 'PASS: #9 別の利用者には f・mr 宛てのいいねが1件も返らない'
            else 'FAIL: #9 他人の受信いいねが返った' end;
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select case when (select count(*) from public.get_received_likes_page()) = 0
            then 'PASS: #10 身元（sub）の無い呼び出しは0行'
            else 'FAIL: #10 身元なしで行が返った' end;
reset role;

\echo '=== 権限と定義 ==='
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ begin
  begin
    perform public.get_received_likes_page();
    raise notice 'FAIL: #11 anon が実行できてしまった';
  exception
    when insufficient_privilege then raise notice 'PASS: #11 anon は permission denied';
    when others then raise notice 'FAIL?: #11 想定外の拒否理由 (%)', sqlerrm;
  end;
end $$;
reset role;
select case
  when not has_function_privilege('anon', 'public.get_received_likes_page(timestamptz,uuid,integer)', 'execute')
   and has_function_privilege('authenticated', 'public.get_received_likes_page(timestamptz,uuid,integer)', 'execute')
   and has_function_privilege('service_role', 'public.get_received_likes_page(timestamptz,uuid,integer)', 'execute')
   and (select proacl::text from pg_proc
        where oid = 'public.get_received_likes_page(timestamptz,uuid,integer)'::regprocedure) not like '%{=X/%'
   and (select proacl::text from pg_proc
        where oid = 'public.get_received_likes_page(timestamptz,uuid,integer)'::regprocedure) not like '%,=X/%'
  then 'PASS: #12 ACL は authenticated/service_role のみ（anon・PUBLIC なし）'
  else 'FAIL: #12 ACL が想定と違う' end;
select case when p.prosecdef = false and 'search_path=public' = any(p.proconfig)
            then 'PASS: #13 SECURITY INVOKER かつ search_path=public'
            else 'FAIL: #13 定義が想定と違う' end
from pg_proc p where p.oid = 'public.get_received_likes_page(timestamptz,uuid,integer)'::regprocedure;

rollback;
