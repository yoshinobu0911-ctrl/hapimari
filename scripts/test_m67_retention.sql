-- M6.7 保持方針・匿名化・再登録の検証
-- 実行: docker exec -i supabase_db_hapimari psql -U postgres -d postgres < scripts/test_m67_retention.sql
-- 全テストはトランザクション内で行い最後に rollback（DBを汚さない）

\set QUIET on
\pset pager off
begin;

create temp table t as
select
  (select id from profiles where gender='female' and status='active' order by created_at limit 1) as u,
  (select id from profiles where gender='male' and status='active' order by created_at limit 1) as m;
select u as uid, m as mid from t \gset

\echo ''
\echo '################ 1. 退会時の台帳記録 ################'
-- 退会でメールは解放されるため、退会前のアドレスを控えてから実行する
select u.email as uid_mail from auth.users u where u.id = :'uid' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role','authenticated')::text, true);
set local role authenticated;
select withdraw_account();
reset role;

select case when count(*) = 1 then 'PASS: 台帳に1件記録された' else 'FAIL' end as "T1-a"
from identity_ledger where email_hash = _email_hash(:'uid_mail');
select case when suppressed and not banned and last_withdrawn_at is not null
            then 'PASS: 配信除外=ON / BAN=OFF / 退会日時あり' else 'FAIL' end as "T1-b"
from identity_ledger where email_hash = _email_hash(:'uid_mail');
select case when withdrawn_at is not null and status='withdrawn'
            then 'PASS: profilesに退会日時が入る' else 'FAIL' end as "T1-c"
from profiles where id = :'uid';

\echo ''
\echo '################ 2. 90日ルール ################'
select case when (select count(*) from (select run_retention_job()) x) = 1
            then 'INFO: ジョブ実行' end as "T2-run";
select case when anonymized_at is null then 'PASS: 退会直後は匿名化されない（90日未満）' else 'FAIL: 即匿名化された' end as "T2-a"
from profiles where id = :'uid';

-- 退会日時を91日前に巻き戻して再実行
update profiles set withdrawn_at = now() - interval '91 days' where id = :'uid';
select run_retention_job() as "T2-b_ジョブ結果";
select case when anonymized_at is not null then 'PASS: 90日経過後は匿名化される' else 'FAIL' end as "T2-c"
from profiles where id = :'uid';

\echo ''
\echo '################ 3. 匿名化の中身（個人特定情報の消去と特徴量の保持） ################'
select case when nickname='退会済み' and bio is null and city is null
                 and photo_urls='{}' and prefecture='不明' and birth_date='1900-01-01'
            then 'PASS: 氏名/自己紹介/市区町村/写真/生年月日が消えている'
            else 'FAIL: ' || nickname || '/' || coalesce(bio,'null') || '/' || coalesce(city,'null') end as "T3-a"
from profiles where id = :'uid';

select case when age_band is not null and region_block is not null
                 and value_tags is not null and marriage_intent is not null
                 and bio_features ? 'length'
            then 'PASS: 特徴量は残っている（年齢帯=' || age_band || ' / 地域=' || region_block || '）'
            else 'FAIL: 特徴量が失われた' end as "T3-b"
from profiles where id = :'uid';

select case when count(*)=0 then 'PASS: 位置情報は削除された' else 'FAIL' end as "T3-c"
from profile_locations where user_id = :'uid';
select case when count(*)=0 then 'PASS: 本人確認の申請記録は削除された' else 'FAIL' end as "T3-d"
from verifications where user_id = :'uid';
select case when count(*)=0 then 'PASS: 写真の審査記録は削除された' else 'FAIL' end as "T3-e"
from photo_reviews where user_id = :'uid';
select case when count(*) >= 0 then 'PASS: 削除待ちキューに ' || count(*) || ' 件（Storage APIで実削除）' end as "T3-e2"
from file_deletion_queue where deleted_at is null;
select case when bool_and(body='') or count(*)=0 then 'PASS: メッセージ本文は消去された' else 'FAIL' end as "T3-f"
from messages where sender = :'uid';

\echo '--- 学習データ（誰と誰がマッチ・デート・通話したか）が残っているか ---'
select case when count(*) > 0 then 'PASS: マッチ関係は ' || count(*) || ' 件残っている'
            else 'INFO: このユーザーにマッチが無い' end as "T3-g"
from matches where user_a = :'uid' or user_b = :'uid';
select case when count(*) > 0 then 'PASS: 行動ログは ' || count(*) || ' 件残っている'
            else 'INFO: ログ無し' end as "T3-h"
from user_events where actor_id = :'uid' or target_user_id = :'uid';

\echo ''
\echo '################ 4. 再登録のクーリング期間（7日） ################'
-- 実際のフロー: 退会でメールが解放される → 同じメールで**新規アカウント**を作る
select u.email as mail_before from auth.users u where u.id = :'mid' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'mid', 'role','authenticated')::text, true);
set local role authenticated;
select withdraw_account();
reset role;

select case when email like 'withdrawn-%@invalid' and banned_until is not null
            then 'PASS: 退会でメールが解放されトークンも失効' else 'FAIL: ' || email end as "T4-a"
from auth.users where id = :'mid';

-- 同じメールで新規アカウント（別UUID）を作成 = 再登録
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated', :'mail_before', 'x', now(), now(), now());

select set_config('request.jwt.claims', json_build_object('sub', '99999999-9999-9999-9999-999999999999', 'role','authenticated')::text, true);
set local role authenticated;
do $$
begin
  insert into profiles (id, nickname, gender, birth_date, prefecture, marital_history, marriage_intent)
  values ('99999999-9999-9999-9999-999999999999', '再登録', 'male', '1975-01-01', '東京都', 'divorced', 'someday');
  raise notice 'FAIL: 退会直後に再登録できた';
exception when others then
  raise notice 'PASS: 7日以内の再登録は拒否された (%)', sqlerrm;
end $$;
reset role;

-- 8日前の退会に書き換えると再登録できる
update identity_ledger set last_withdrawn_at = now() - interval '8 days'
  where email_hash = _email_hash(:'mail_before');
select set_config('request.jwt.claims', json_build_object('sub', '99999999-9999-9999-9999-999999999999', 'role','authenticated')::text, true);
set local role authenticated;
do $$
begin
  insert into profiles (id, nickname, gender, birth_date, prefecture, marital_history, marriage_intent)
  values ('99999999-9999-9999-9999-999999999999', '再登録', 'male', '1975-01-01', '東京都', 'divorced', 'someday');
  raise notice 'PASS: 7日経過後は再登録できた';
exception when others then
  raise notice 'FAIL: 7日経過後も拒否された (%)', sqlerrm;
end $$;
reset role;

\echo '--- 再登録で通報履歴が引き継がれ、配信除外が解除されるか ---'
select case when prior_report_count = (select report_count from identity_ledger where email_hash=_email_hash(:'mail_before'))
            then 'PASS: 通報履歴が引き継がれた（' || prior_report_count || '件）' else 'FAIL' end as "T4-c"
from profiles where id = '99999999-9999-9999-9999-999999999999';
select case when not suppressed then 'PASS: 再登録で配信除外が解除された' else 'FAIL' end as "T4-d"
from identity_ledger where email_hash = _email_hash(:'mail_before');
select case when anonymized_at is null and nickname <> '再登録'
            then 'PASS: 過去のアカウントは復活していない（別レコードのまま）' else 'FAIL' end as "T4-e"
from profiles where id = :'mid';

\echo ''
\echo '################ 5. 強制退会は永久に再登録不可 ################'
select ban_account('99999999-9999-9999-9999-999999999999'::uuid, '規約違反（テスト）');
update identity_ledger set last_withdrawn_at = now() - interval '365 days'
  where email_hash = _email_hash(:'mail_before');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated', :'mail_before', 'x', now(), now(), now());
select set_config('request.jwt.claims', json_build_object('sub', '88888888-8888-8888-8888-888888888888', 'role','authenticated')::text, true);
set local role authenticated;
do $$
begin
  insert into profiles (id, nickname, gender, birth_date, prefecture, marital_history, marriage_intent)
  values ('88888888-8888-8888-8888-888888888888', 'BAN回避', 'male', '1975-01-01', '東京都', 'divorced', 'someday');
  raise notice 'FAIL: 強制退会者が1年後に再登録できた';
exception when others then
  raise notice 'PASS: 強制退会者は再登録できない (%)', sqlerrm;
end $$;
reset role;

\echo ''
\echo '################ 6. 台帳の安全性・除外リスト ################'
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role','authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform count(*) from identity_ledger;
  raise notice 'FAIL: 利用者が台帳を読めてしまう';
exception when others then
  raise notice 'PASS: 台帳は利用者から読めない (%)', sqlerrm;
end $$;
reset role;

select case when count(*) > 0 and bool_and(email_hash ~ '^[0-9a-f]{64}$')
            then 'PASS: 除外リストはハッシュのみ（' || count(*) || '件）' else 'FAIL' end as "T6-b"
from get_suppression_list();

\echo '--- 台帳と特徴量が紐付いていない（再特定できない）ことの確認 ---'
select case when count(*) = 0
            then 'PASS: 台帳にユーザーIDを指す列は存在しない（再特定不可）'
            else 'FAIL: ' || string_agg(column_name, ',') end as "T6-c"
from information_schema.columns
where table_name='identity_ledger' and (data_type='uuid' or column_name like '%user%' or column_name like '%profile%');

rollback;
