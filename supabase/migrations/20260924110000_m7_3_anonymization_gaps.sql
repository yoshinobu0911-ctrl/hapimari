-- ============================================================
-- 匿名化で見落としていた自由文・決済識別子を追加で消す（2026-09-24）
--
-- 背景: PR#1 レビュー統合表 I27（自由文の残存）・I41（Stripe経由の再識別）・I42（通報保存方針）。
--   設計: docs/design/2026-09-24_匿名化追加対応_設計提案.md（確認質問1=A採用／2=対象該当なし／3=文書化のみ）
--
-- 採用した選択肢:
--   ①confirmed_slot は残す（相手も見ている成立済みデートの記録のため。area_suggestionのみ消す）
--   ②既匿名化済み行への遡及補修は対象なし（本番未作成・ローカルにも該当なしのため今回は実施しない）
--   ③reports.reason/detail はコード変更せず、保存方針を docs/legal/privacy_policy.md に文書化する
-- ============================================================

create or replace function public.anonymize_profile(p_user uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  paths text[];
begin
  -- 写真・本人確認画像の「実体」は SQL から直接削除できない（Supabaseの仕様で
  -- storage テーブルへの直接DELETEは禁止・Storage API 経由のみ）。
  -- そこで削除待ちキューに積み、管理画面のジョブが Storage API で消す。
  select photo_urls into paths from profiles where id = p_user;
  if paths is not null and array_length(paths, 1) > 0 then
    delete from photo_reviews where path = any(paths);
  end if;
  delete from photo_reviews where user_id = p_user;

  -- photo_urls に載っている分だけでなく、**そのユーザーのフォルダ配下すべて**を対象にする。
  -- （プロフィールから外した写真がバケットに残り続けるのを防ぐ。検証で発見した漏れ）
  insert into file_deletion_queue (bucket_id, path)
    select 'photos', o.name from storage.objects o
    where o.bucket_id = 'photos'
      and (storage.foldername(o.name))[1] = p_user::text
  on conflict do nothing;
  if paths is not null and array_length(paths, 1) > 0 then
    insert into file_deletion_queue (bucket_id, path)
      select 'photos', p from unnest(paths) p on conflict do nothing;
  end if;

  insert into file_deletion_queue (bucket_id, path)
    select 'verifications', o.name from storage.objects o
    where o.bucket_id = 'verifications'
      and (storage.foldername(o.name))[1] = p_user::text
  on conflict do nothing;
  delete from verifications where user_id = p_user;

  -- 位置情報を削除
  delete from profile_locations where user_id = p_user;

  -- メッセージ本文を削除（誰と何往復したかの事実は学習用に残す）
  update messages set body = '' where sender = p_user;

  -- ------------------------------------------------------------
  -- 2026-09-24追加（I27）: messages.body 以外に残っていた自由文
  -- ------------------------------------------------------------

  -- いいねの一言（messages.bodyと同じ扱い。本人が送った分のみ）
  update likes set message = null where from_user = p_user;

  -- デートの自由文候補のうち、本人が提案した分だけを取り除く（相手が提案した分は残る）。
  -- confirmed_slot（成立済みの日程・場所）は相手も見ている確定記録のため、ここでは消さない
  -- （2026-09-24 確認質問1=A採用。area_suggestionは提案者の記録が無く単独の地名程度のため消す）
  update date_proposals d set
    proposed_slots = (
      select coalesce(jsonb_agg(s), '[]'::jsonb)
      from jsonb_array_elements(coalesce(d.proposed_slots, '[]'::jsonb)) s
      where s ->> 'proposed_by' <> p_user::text
    ),
    area_suggestion = null
  from matches m
  where m.id = d.match_id and (m.user_a = p_user or m.user_b = p_user);

  -- 行動ログは行を残したまま紐付けだけ外す（件数の集計は壊れない）
  update user_events set actor_id = null, target_user_id = null, props = '{}'::jsonb
  where actor_id = p_user or target_user_id = p_user;

  -- ------------------------------------------------------------
  -- 2026-09-24追加（I41）: 決済識別子の削除
  -- 前提: 決済修正（M7.3・20260924100000）のwithdraw_accountガードにより、
  -- 稼働中の契約が残ったままでは退会できない。したがってここに到達する時点
  -- （退会から90日経過）で、この行がStripe側で未精算のまま残っていることはない。
  -- ------------------------------------------------------------
  delete from subscriptions where user_id = p_user;

  -- プロフィール: 特徴量へ変換し、個人を特定できる列を消す
  update profiles set
    age_band = public._age_band(birth_date),
    region_block = public._region_block(prefecture),
    bio_features = public._bio_features(bio),
    nickname = '退会済み',
    birth_date = '1900-01-01',          -- not null 制約があるため既定値へ（年齢帯のみ残す）
    prefecture = '不明',
    city = null,
    bio = null,
    photo_urls = '{}',
    voice_profile_url = null,
    email_bounced = false,
    anonymized_at = now()
  where id = p_user;
end $$;
revoke execute on function public.anonymize_profile(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_profile(uuid) to service_role;
