-- I11（PR#1 統合指摘表）: 写真の閲覧に「閲覧者が在籍中（status='active'）」の条件を追加する。
-- 退会・凍結・プロフィール未作成の人が、一覧取得→署名URL発行の経路で他人の承認済み写真を
-- 読めていた穴を塞ぐ（オーナー追加指示: 経路を完全に潰す／本人の未承認写真プレビューは維持）。
-- 設計: docs/design/2026-09-24_P2必須6件_設計提案.md I11 節
--
-- 2関数の本体は現行（m6_6 / review2）を写し、先頭に is_caller_active() を足しただけ。
-- ブロック判定の呼び先 public.is_blocked_between は I29 で private. に付け替える。

-- 1) Storage 用の可視判定（20260730100000_m6_6_audit_fixes.sql の定義を置換）
create or replace function public.is_photo_visible_to(p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_caller_active()   -- 追加: 閲覧者 status='active'（未作成・凍結・退会・匿名化済みは false）
     and exists (
       select 1 from photo_reviews pr
       join profiles owner on owner.id = pr.user_id
       where pr.path = p_path
         and pr.status = 'approved'
         and owner.status = 'active'
         and not public.is_blocked_between(auth.uid(), pr.user_id)
     );
$$;
revoke execute on function public.is_photo_visible_to(text) from public, anon;
grant  execute on function public.is_photo_visible_to(text) to authenticated, service_role;

-- 2) プロフィール表示用（20260902100000_review2_security_fixes.sql の定義を置換。所有者一致の検査は残す）
create or replace function public.is_photo_of_profile(p_path text, p_owner uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_caller_active()   -- 追加
     and exists (
       select 1 from photo_reviews pr
       join profiles owner on owner.id = pr.user_id
       where pr.path = p_path
         and pr.user_id = p_owner          -- 所有者の一致（なりすまし防止の本体）
         and pr.status = 'approved'
         and owner.status = 'active'
         and not public.is_blocked_between(auth.uid(), pr.user_id)
     );
$$;
revoke execute on function public.is_photo_of_profile(text, uuid) from public, anon;
grant  execute on function public.is_photo_of_profile(text, uuid) to authenticated, service_role;

-- 3) Storage SELECT ポリシー（m6_6 の定義を置換）
--    実在する名前（63バイト上限で切り詰められた61バイト）を if exists なしで drop する。
--    名前が合わなければ migration ごと失敗させる
drop policy "photos_本人または可視な承認済みのみ読み取り" on storage.objects;
create policy "photos_本人または可視な承認済みのみ読み取り" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (
      -- 本人フォルダ: 条件なし（凍結・退会中でも本人の未承認写真プレビューを維持）
      (storage.foldername(name))[1] = auth.uid()::text
      -- 他人: 在籍中を明示（関数内の条件と二重）。InitPlan で文ごとに1回だけ評価
      or ((select public.is_caller_active()) and public.is_photo_visible_to(name))
    )
  );

-- 4) 自己検査（本番適用時にも走る）。permissive なポリシーは OR で結合されるので、
--    条件なしの読み取りポリシーが残っていないことを確かめる
do $$
declare n_photo int; n_unscoped int;
begin
  select count(*) into n_photo from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL')
     and qual like '%photos%';
  select count(*) into n_unscoped from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL')
     and (qual is null or qual not like '%bucket_id%');
  if n_photo <> 1 or n_unscoped <> 0 or not exists (
       select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'photos_本人または可視な承認済みのみ読み取り'
          and cmd = 'SELECT' and qual like '%is_caller_active%' and qual like '%foldername%') then
    raise exception 'I11: storage.objects の読み取りポリシーが想定外 (photos=%, bucket無指定=%)',
      n_photo, n_unscoped;
  end if;
end $$;
