-- I11（2026-09-26）: 写真閲覧の閲覧者在籍条件の攻撃再現・回帰テスト
-- 実行: bash scripts/run_sql_tests.sh（期待 PASS 21件）
-- 全テストはトランザクション内で行い最後に rollback（DBを汚さない）
-- 見出しや説明文には判定語を入れない（ランナーは判定語を含む行を数えるため）

\set QUIET on
\pset pager off

begin;

create temp table t_ids as
select
  (select id from profiles where gender = 'female' and status = 'active'
     order by created_at, id limit 1) as v,
  (select id from profiles where gender = 'male' and status = 'active'
     order by created_at, id limit 1) as o,
  gen_random_uuid() as n;
grant select on t_ids to authenticated, anon, service_role;
select v as v_id, o as o_id, n as n_id from t_ids \gset

delete from blocks where (blocker = :'v_id' and blocked = :'o_id') or (blocker = :'o_id' and blocked = :'v_id');
insert into photo_reviews (path, user_id, status, reviewed_at)
values (:'o_id' || '/test_i11_other.jpg', :'o_id', 'approved', now())
on conflict (path) do update set status = 'approved', user_id = excluded.user_id;
insert into photo_reviews (path, user_id, status)
values (:'v_id' || '/test_i11_own.jpg', :'v_id', 'pending')
on conflict (path) do update set status = 'pending', user_id = excluded.user_id;
insert into storage.objects (bucket_id, name) values
  ('photos', :'o_id' || '/test_i11_other.jpg'),
  ('photos', :'v_id' || '/test_i11_own.jpg'),
  ('photos', :'n_id' || '/test_i11_onboarding.jpg');

-- 閲覧者視点の観測を1文にまとめる。security_invoker でないとビュー所有者（postgres）の権限で
-- storage.objects が読まれ RLS が効かない（初版で実際に起きた誤り）
create temp view t_obs with (security_invoker = true) as
select
  (select count(*) from storage.objects
    where bucket_id = 'photos' and name = (select o from t_ids) || '/test_i11_other.jpg') as other_rows,
  (select count(*) from storage.objects
    where bucket_id = 'photos'
      and (storage.foldername(name))[1] <> coalesce(auth.uid()::text, '')) as not_own_rows,
  (select count(*) from storage.objects
    where bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text) as own_rows,
  public.is_photo_visible_to((select o from t_ids) || '/test_i11_other.jpg') as visible_fn,
  public.is_photo_of_profile((select o from t_ids) || '/test_i11_other.jpg', (select o from t_ids)) as of_profile_fn;
grant select on t_obs to authenticated, anon, service_role;

\echo '=== 在籍中の閲覧者（回帰） ==='
select set_config('request.jwt.claims', json_build_object('sub', :'v_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when other_rows = 1 then 'PASS: #1 在籍中は他人の承認済み写真が1行見える'
            else 'FAIL: #1 在籍中なのに見えない (' || other_rows || ')' end from t_obs;
select case when visible_fn and of_profile_fn then 'PASS: #2 在籍中は2関数とも true'
            else 'FAIL: #2 在籍中なのに関数が false' end from t_obs;
select case when not public.is_photo_of_profile((select o from t_ids) || '/test_i11_other.jpg', (select v from t_ids))
            then 'PASS: #3 持ち主を取り違えた呼び出しは false'
            else 'FAIL: #3 持ち主の取り違えで true' end;
reset role;

\echo '=== 凍結 ==='
select set_config('request.jwt.claims', '', true);
update profiles set status = 'suspended' where id = :'v_id';
select set_config('request.jwt.claims', json_build_object('sub', :'v_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when other_rows = 0 then 'PASS: #4 凍結者は他人の写真が0行'
            else 'FAIL: #4 凍結者が他人の写真を読める (' || other_rows || ')' end from t_obs;
select case when not_own_rows = 0 then 'PASS: #5 凍結者の一覧は本人フォルダ以外0行'
            else 'FAIL: #5 凍結者の一覧に他人の行 (' || not_own_rows || ')' end from t_obs;
select case when not visible_fn and not of_profile_fn then 'PASS: #6 凍結者は2関数とも false'
            else 'FAIL: #6 凍結者に関数が true' end from t_obs;
select case when own_rows = 1 then 'PASS: #7 凍結者も自分の未承認写真は見える'
            else 'FAIL: #7 凍結者の本人プレビューが消えた (' || own_rows || ')' end from t_obs;
reset role;
select set_config('request.jwt.claims', '', true);
update profiles set status = 'active' where id = :'v_id';
select set_config('request.jwt.claims', json_build_object('sub', :'v_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when other_rows = 1 then 'PASS: #8 凍結解除で再び見える'
            else 'FAIL: #8 凍結解除後も見えない' end from t_obs;
reset role;

\echo '=== 退会 ==='
select set_config('request.jwt.claims', '', true);
update profiles set status = 'withdrawn' where id = :'v_id';
select set_config('request.jwt.claims', json_build_object('sub', :'v_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when other_rows = 0 then 'PASS: #9 退会者は他人の写真が0行'
            else 'FAIL: #9 退会者が他人の写真を読める (' || other_rows || ')' end from t_obs;
select case when not_own_rows = 0 then 'PASS: #10 退会者の一覧は本人フォルダ以外0行'
            else 'FAIL: #10 退会者の一覧に他人の行 (' || not_own_rows || ')' end from t_obs;
select case when not visible_fn and not of_profile_fn then 'PASS: #11 退会者は2関数とも false'
            else 'FAIL: #11 退会者に関数が true' end from t_obs;
select case when own_rows = 1 then 'PASS: #12 退会者も自分の写真は見える'
            else 'FAIL: #12 退会者の本人フォルダが見えない (' || own_rows || ')' end from t_obs;
reset role;
select set_config('request.jwt.claims', '', true);
update profiles set status = 'active' where id = :'v_id';

\echo '=== プロフィール未作成 ==='
select set_config('request.jwt.claims', json_build_object('sub', :'n_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when other_rows = 0 then 'PASS: #13 未作成者は他人の写真が0行'
            else 'FAIL: #13 未作成者が他人の写真を読める (' || other_rows || ')' end from t_obs;
select case when not_own_rows = 0 then 'PASS: #14 未作成者の一覧は本人フォルダ以外0行'
            else 'FAIL: #14 未作成者の一覧に他人の行 (' || not_own_rows || ')' end from t_obs;
select case when not visible_fn and not of_profile_fn then 'PASS: #15 未作成者は2関数とも false'
            else 'FAIL: #15 未作成者に関数が true' end from t_obs;
select case when own_rows = 1 then 'PASS: #16 未作成者も自分のフォルダは見える'
            else 'FAIL: #16 未作成者の本人フォルダが見えない (' || own_rows || ')' end from t_obs;
reset role;

\echo '=== その他 ==='
select set_config('request.jwt.claims', '', true);
set local role anon;
select case when (select count(*) from storage.objects where bucket_id = 'photos') = 0
            then 'PASS: #17 anon は0行' else 'FAIL: #17 anon に行が見える' end;
reset role;
set local role service_role;
select case when (select count(*) from storage.objects
                  where bucket_id = 'photos' and name = (select o from t_ids) || '/test_i11_other.jpg') = 1
            then 'PASS: #18 service_role は読める（管理画面の審査）'
            else 'FAIL: #18 service_role が読めない' end;
reset role;
select case
  when (select count(*) from pg_policies
         where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL')
           and qual like '%photos%') = 1
   and exists (select 1 from pg_policies
         where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
           and qual like '%photos%' and qual like '%is_caller_active%' and qual like '%foldername%')
   and (select count(*) from pg_policies
         where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL')
           and (qual is null or qual not like '%bucket_id%')) = 0
  then 'PASS: #19 photos の読み取りポリシーは1本で在籍条件と本人分岐を含む'
  else 'FAIL: #19 読み取りポリシーが想定外' end;
select case when (select public from storage.buckets where id = 'photos') = false
            then 'PASS: #20 photos バケットは非公開'
            else 'FAIL: #20 photos バケットが公開' end;
select case when bool_and(
         not has_function_privilege('anon', f, 'execute')
         and has_function_privilege('authenticated', f, 'execute')
         and has_function_privilege('service_role', f, 'execute'))
  then 'PASS: #21 3関数とも anon 不可・authenticated/service_role 可'
  else 'FAIL: #21 3関数の ACL が想定外' end
from unnest(array['public.is_caller_active()', 'public.is_photo_visible_to(text)',
                  'public.is_photo_of_profile(text,uuid)']) as f;

rollback;
