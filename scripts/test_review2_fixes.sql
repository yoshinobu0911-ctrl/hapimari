-- レビュー第2弾（2026-09-02）攻撃再現テスト（psql・ロールなりすましで authenticated 視点を再現)
-- 実行: docker cp scripts/test_review2_fixes.sql supabase_db_hapimari:/tmp/ &&
--       docker exec supabase_db_hapimari psql -U postgres -d postgres -f /tmp/test_review2_fixes.sql
-- 全テストはトランザクション内で行い最後に rollback（DBを汚さない）
-- ※ 並列競合（#4 位置更新 / #10 相互いいね）は単一セッションでは再現できないため
--    scripts/test_review2_concurrency.sh で別途実測する

\set QUIET on
\pset pager off

begin;

create temp table t_ids as
select
  (select id from profiles where gender = 'female' and status = 'active' and is_verified order by created_at limit 1) as f,
  (select id from profiles where gender = 'male' and status = 'active' and is_verified order by created_at limit 1) as m,
  (select id from profiles where gender = 'male' and status = 'active'
     and id <> (select id from profiles where gender = 'male' and status = 'active' and is_verified order by created_at limit 1)
   order by created_at limit 1) as m2;
grant select on t_ids to authenticated;
select f as female_id, m as male_id, m2 as male2_id from t_ids \gset

\echo '=== T1: 一般利用者は review_verification を実行できない（#1） ==='
-- 被害シナリオ: 利用者が自分の本人確認申請を自分で承認する
insert into verifications (id, user_id, kind, document_url)
values ('99999999-0000-0000-0000-000000000001', :'male_id', 'identity', 'dummy/doc.jpg');
select set_config('request.jwt.claims', json_build_object('sub', :'male_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform review_verification('99999999-0000-0000-0000-000000000001'::uuid, true, null, null);
    raise notice 'FAIL: 一般利用者が本人確認を承認できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: review_verification は permission denied (%)', sqlerrm;
    when others then
      raise notice 'FAIL?: 想定外の拒否理由 (%)', sqlerrm;
  end;
end $$;
reset role;

\echo '=== T2: review_verification のACLと旧3引数版の削除（#1） ==='
select case when count(*) = 0 then 'PASS: 旧3引数版は削除済み'
            else 'FAIL: 旧3引数版が残っている' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'review_verification' and p.pronargs = 3;
select case
  when not has_function_privilege('anon', 'public.review_verification(uuid,boolean,text,uuid)', 'execute')
   and not has_function_privilege('authenticated', 'public.review_verification(uuid,boolean,text,uuid)', 'execute')
   and has_function_privilege('service_role', 'public.review_verification(uuid,boolean,text,uuid)', 'execute')
  then 'PASS: 実行権限は service_role のみ'
  else 'FAIL: ACLが想定と異なる' end;

\echo '=== T3: 他人の承認済みパスを自分の photo_urls に入れられない（#2 書き込み側） ==='
-- 被害者(female)の承認済み写真を用意
insert into photo_reviews (path, user_id, status, reviewed_at)
values (:'female_id' || '/photo_victim.jpg', :'female_id', 'approved', now())
on conflict (path) do update set status = 'approved', user_id = excluded.user_id;
select set_config('request.jwt.claims', json_build_object('sub', :'male_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare victim_path text;
begin
  select f || '/photo_victim.jpg' into victim_path from t_ids;
  begin
    update profiles set photo_urls = array[victim_path] where id = auth.uid();
    raise notice 'FAIL: 他人のパスを自分の photo_urls に保存できてしまった';
  exception when others then
    if sqlerrm = 'invalid_photo_path' then
      raise notice 'PASS: 書き込みが invalid_photo_path で拒否された';
    else
      raise notice 'FAIL?: 想定外の拒否理由 (%)', sqlerrm;
    end if;
  end;
end $$;
reset role;

\echo '=== T4: 仮に書き込めても他人の写真は表示されない（#2 表示側・所有者検証） ==='
-- 書き込み検証を飛ばして直接（postgres権限で）攻撃状態を作る＝未知の書込経路を想定
select set_config('request.jwt.claims', '', true); -- postgres作業前にクレームを消す
update profiles set photo_urls = array[(select f || '/photo_victim.jpg' from t_ids)]
where id = :'male_id';
select set_config('request.jwt.claims', json_build_object('sub', :'male2_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when coalesce(array_length(photo_urls, 1), 0) = 0
            then 'PASS: 攻撃者のプロフィールに被害者の写真は表示されない'
            else 'FAIL: 表示されている ' || photo_urls::text end
from profiles_public where id = :'male_id';
reset role;
-- 回帰: 本来の持ち主のプロフィールでは承認済み写真が表示される
select set_config('request.jwt.claims', '', true);
update profiles set photo_urls = array[(select f || '/photo_victim.jpg' from t_ids)]
where id = :'female_id';
select set_config('request.jwt.claims', json_build_object('sub', :'male2_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when photo_urls = array[(select f || '/photo_victim.jpg' from t_ids)]
            then 'PASS: 持ち主本人のプロフィールでは表示される（回帰なし）'
            else 'FAIL: 持ち主の写真が消えた ' || photo_urls::text end
from profiles_public where id = :'female_id';
reset role;

\echo '=== T5: 承認済みパスへの上書き経路が閉じている（#3） ==='
select set_config('request.jwt.claims', '', true);
-- 5a: storage.objects の UPDATE ポリシーが存在しない
select case when count(*) = 0 then 'PASS: photos の UPDATE ポリシーは削除済み'
            else 'FAIL: ' || string_agg(policyname, ',') end
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and cmd = 'UPDATE' and qual like '%photos%';
-- 5b: authenticated として自分のオブジェクトを上書きできない（0行 or 権限エラー）
insert into storage.objects (bucket_id, name, owner_id)
values ('photos', :'male_id' || '/photo_own.jpg', :'male_id')
on conflict do nothing;
select set_config('request.jwt.claims', json_build_object('sub', :'male_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n int;
begin
  begin
    update storage.objects set updated_at = now()
    where bucket_id = 'photos' and name = (select m || '/photo_own.jpg' from t_ids);
    get diagnostics n = row_count;
    if n = 0 then
      raise notice 'PASS: 上書きは0行（ポリシー不在で不可視）';
    else
      raise notice 'FAIL: 本人でもオブジェクトを上書きできてしまった (%行)', n;
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS: 上書きは permission denied';
  end;
end $$;
reset role;
-- 5c: 同一パスの再審査登録は approved を必ず pending に戻す
select set_config('request.jwt.claims', '', true);
insert into photo_reviews (path, user_id, status, reviewed_at)
values (:'male_id' || '/photo_own.jpg', :'male_id', 'approved', now())
on conflict (path) do update set status = 'approved';
select set_config('request.jwt.claims', json_build_object('sub', :'male_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select register_photo_for_review(:'male_id' || '/photo_own.jpg');
reset role;
select case when status = 'pending' and reviewed_at is null
            then 'PASS: 再登録で pending に戻る（承認の持ち越し不可）'
            else 'FAIL: status=' || status end
from photo_reviews where path = :'male_id' || '/photo_own.jpg';
-- 5d: 「削除→同一パスへ再アップロード」の迂回も閉じている（敵対的検証で発見した経路）
select set_config('request.jwt.claims', json_build_object('sub', :'male_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare n int; own_path text;
begin
  select m || '/photo_own.jpg' into own_path from t_ids;
  begin
    delete from storage.objects where bucket_id = 'photos' and name = own_path;
    get diagnostics n = row_count;
    if n = 0 then
      raise notice 'PASS: 本人でもオブジェクトを削除できない（DELETEポリシー撤去済み）';
    else
      raise notice 'FAIL: 削除できてしまった（削除→再アップロードで審査素通りが可能） (%行)', n;
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS: 削除は permission denied';
  end;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('photos', own_path, (select m::text from t_ids));
    raise notice 'FAIL: 既存パスへ再挿入できてしまった';
  exception when unique_violation then
    raise notice 'PASS: 既存パスへの再挿入は一意制約違反で拒否';
  when others then
    raise notice 'PASS?: 再挿入は拒否された (%)', sqlerrm;
  end;
end $$;
reset role;

\echo '=== T6: 全関数ACLの総点検（#5 と同型の横展開） ==='
select case when count(*) = 0 then 'PASS: anon が実行できる関数は0件'
            else 'FAIL: ' || string_agg(sig, ', ') end
from (
  select p.oid::regprocedure::text as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
) x;
\echo '--- authenticated が実行できる関数の一覧（許可リストとの照合用） ---'
select p.oid::regprocedure::text as authenticated_executable
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
order by 1;

\echo '=== T7: voice_profile_url は書き込み不可（#6） ==='
select set_config('request.jwt.claims', json_build_object('sub', :'male_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    update profiles set voice_profile_url = 'https://evil.example.com/x.mp3' where id = auth.uid();
    raise notice 'FAIL: voice_profile_url に任意URLを保存できてしまった';
  exception when insufficient_privilege then
    raise notice 'PASS: voice_profile_url の更新は permission denied';
  end;
end $$;
reset role;

\echo '=== T8: デート提案の p_area / label 検証（#9） ==='
select set_config('request.jwt.claims', '', true);
-- 非ブロックのペア（male2 × female）でマッチ+意向一致済みの提案を用意
insert into matches (user_a, user_b)
select least(f, m2), greatest(f, m2) from t_ids on conflict (user_a, user_b) do nothing;
create temp table t8_match as
select id as match_id from matches, t_ids where user_a = least(f, m2) and user_b = greatest(f, m2);
grant select on t8_match to authenticated;
delete from date_proposals where match_id in (select match_id from t8_match);
insert into date_proposals (match_id, intent_a, intent_b, status)
select match_id, true, true, 'matched' from t8_match;
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare mid uuid; slot jsonb;
begin
  select match_id into mid from t8_match;
  slot := jsonb_build_object(
    'date', ((now() at time zone 'Asia/Tokyo')::date + 2)::text,
    'time_range', 'weekend_am', 'label', 'テスト日程');
  begin
    perform propose_date_slot(mid, slot, '必ず儲かる投資セミナー会場');
    raise notice 'FAIL: NGワード入りエリア名が通ってしまった';
  exception when others then
    if sqlerrm = 'fraud_words_in_proposal' then
      raise notice 'PASS: NGワード入りエリア名は拒否 (fraud_words_in_proposal)';
    else
      raise notice 'FAIL?: 想定外の拒否理由 (%)', sqlerrm;
    end if;
  end;
  begin
    perform propose_date_slot(mid, slot, repeat('あ', 41));
    raise notice 'FAIL: 41文字のエリア名が通ってしまった';
  exception when others then
    if sqlerrm = 'invalid_area' then
      raise notice 'PASS: 41文字のエリア名は拒否 (invalid_area)';
    else
      raise notice 'FAIL?: 想定外の拒否理由 (%)', sqlerrm;
    end if;
  end;
  begin
    perform propose_date_slot(mid, jsonb_set(slot, '{label}', to_jsonb('振込先を送ります'::text)), '新宿');
    raise notice 'FAIL: NGワード入りラベルが通ってしまった';
  exception when others then
    if sqlerrm = 'fraud_words_in_proposal' then
      raise notice 'PASS: NGワード入りラベルは拒否 (fraud_words_in_proposal)';
    else
      raise notice 'FAIL?: 想定外の拒否理由 (%)', sqlerrm;
    end if;
  end;
  -- 回帰: 正常なエリア名は通る
  begin
    perform propose_date_slot(mid, slot, '新宿');
    raise notice 'PASS: 正常な提案は成立する（回帰なし）';
  exception when others then
    raise notice 'FAIL: 正常な提案まで拒否された (%)', sqlerrm;
  end;
end $$;
reset role;

\echo '=== T9: 相互いいね→マッチ成立の回帰確認（#10・直列実行） ==='
select set_config('request.jwt.claims', '', true);
delete from likes where (from_user = :'male_id' and to_user = :'female_id')
                     or (from_user = :'female_id' and to_user = :'male_id');
delete from matches where user_a = least(:'male_id'::uuid, :'female_id'::uuid)
                      and user_b = greatest(:'male_id'::uuid, :'female_id'::uuid);
insert into likes (from_user, to_user) values (:'male_id', :'female_id');
insert into likes (from_user, to_user) values (:'female_id', :'male_id');
select case when count(*) = 1 then 'PASS: 直列の相互いいねでマッチ1件成立'
            else 'FAIL: マッチ件数=' || count(*) end
from matches
where user_a = least(:'male_id'::uuid, :'female_id'::uuid)
  and user_b = greatest(:'male_id'::uuid, :'female_id'::uuid);

\echo '=== T10: 回帰確認（一覧・距離・審査状況の主要経路） ==='
select set_config('request.jwt.claims', json_build_object('sub', :'female_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select case when count(*) > 1 then 'PASS: profiles_public で他人が見える (' || count(*) || '行)'
            else 'FAIL: ' || count(*) || '行' end from profiles_public;
select case when count(*) >= 0 then 'PASS: get_profile_distances が実行できる' end
from get_profile_distances(array[:'male2_id'::uuid]);
select case when count(*) >= 0 then 'PASS: photo_reviews の自分の行を閲覧できる' end
from photo_reviews where user_id = :'female_id';
reset role;

rollback;
\echo '=== 完了（全変更はrollback済み） ==='
