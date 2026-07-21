-- ============================================================
-- M6.5 セキュリティ強化スプリント P2（写真の非公開化・事前審査の表示接続）
--
--   1. photo_urls を「公開URL」から「バケット内パス」へ移行
--      （seed等の外部URLはそのまま。新規アップロードは以後パスのみ保存）
--   2. 既存写真は承認済みとして photo_reviews へ引き継ぎ
--   3. photos バケット非公開化 + 読み取りは「承認済み or 本人」のみ
--      （表示はクライアントが署名付きURL(1時間)を発行して行う）
--   4. profiles_public の photo_urls を「承認済み写真のみ」に変更
--      （未承認写真はサーバー側で削られるため、クライアント側の考慮が不要）
-- ============================================================

-- 1. 公開URL → バケット内パス（storage URLのみ変換・外部URLは無変化）
update profiles set photo_urls = (
  select array_agg(regexp_replace(u, '^.*/storage/v1/object/public/photos/', '') order by ord)
  from unnest(photo_urls) with ordinality t(u, ord)
)
where photo_urls is not null and array_length(photo_urls, 1) > 0;

-- 2. この時点までに公開されていた写真は承認済みとして引き継ぐ
insert into photo_reviews (path, user_id, status, reviewed_at)
select distinct on (u) u, id, 'approved', now()
from profiles, unnest(photo_urls) u
where photo_urls is not null
on conflict (path) do nothing;

-- 2b. photo_reviews の user_id は auth.users を参照に変更
--     （オンボーディングでは profiles 行の作成前に写真をアップロード＝審査登録するため、
--       profiles 参照だと外部キー違反になる）
alter table photo_reviews drop constraint photo_reviews_user_id_fkey;
alter table photo_reviews
  add constraint photo_reviews_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- 3a. photos バケットを非公開化
update storage.buckets set public = false where id = 'photos';

-- 3b. 承認判定ヘルパ（security definer）。
--     storage.objects のポリシーから photo_reviews を直接参照すると
--     photo_reviews 自身のRLS（本人のみ）で他人の承認行が見えないため、この関数を挟む。
create or replace function public.is_photo_approved(p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from photo_reviews pr where pr.path = p_path and pr.status = 'approved'
  );
$$;
revoke execute on function public.is_photo_approved(text) from public, anon;
grant execute on function public.is_photo_approved(text) to authenticated, service_role;

-- 3c. 読み取りポリシー差し替え: 公開読み取り → 承認済みまたは本人フォルダのみ
drop policy "photos_公開読み取り" on storage.objects;
create policy "photos_承認済みまたは本人のみ読み取り可" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_photo_approved(name)
    )
  );

-- 4. profiles_public: 他人には承認済み写真のみ見せる（本人の行は全写真＝プレビュー用）
create or replace view public.profiles_public as
select
  id,
  nickname,
  gender,
  (date_part('year', age(birth_date)))::int as age,
  prefecture,
  city,
  marital_history,
  marriage_intent,
  cohabit_view,
  money_view,
  bio,
  available_times,
  value_tags,
  case
    when id = auth.uid() then photo_urls
    else coalesce(
      (select array_agg(u order by ord)
       from unnest(photo_urls) with ordinality t(u, ord)
       where public.is_photo_approved(u)),
      '{}')
  end as photo_urls,
  is_verified,
  income_verified,
  single_cert_verified,
  status,
  created_at
from profiles
where
  id = auth.uid()
  or (status = 'active' and not public.is_blocked_between(auth.uid(), id));
