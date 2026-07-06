-- ============================================================
-- M2: 本人確認フロー（モック）+ 管理画面審査
--   1) 本人確認書類用の非公開 Storage バケット
--   2) verifications を申請者本人が閲覧できるようにする（審査待ち画面用）
--   3) 審査確定用の関数（承認/却下 + profiles フラグ反映を原子的に行う）
--   4) profiles を Realtime 配信対象にする（承認が即座にアプリへ反映）
-- ============================================================

-- 1) 書類バケット（非公開）。パス規約: {user_id}/{kind}_{epoch}.{ext}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verifications', 'verifications', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "verifications_本人フォルダのみアップロード可" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'verifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- 閲覧ポリシーは意図的に作らない（管理画面が service_role の署名URLで閲覧する）

-- 2) 審査待ち画面のため、本人の申請のみ SELECT を許可
--    （SPEC §3 の「閲覧は service_role のみ」の例外。QUESTIONS.md Q2 の暫定判断(a)）
create policy "本人は自分の申請を閲覧可" on verifications
  for select to authenticated
  using (user_id = auth.uid());

grant select on public.verifications to authenticated;

-- 3) 審査確定関数（管理画面 = service_role からのみ実行）
--    承認時は kind に対応する profiles のフラグも同時に立てる
create or replace function public.review_verification(
  verification_id uuid,
  approve boolean,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v verifications%rowtype;
begin
  select * into v from verifications where id = verification_id for update;
  if not found then
    raise exception 'verification % not found', verification_id;
  end if;
  if v.status <> 'pending' then
    raise exception 'verification % is already reviewed (status=%)', verification_id, v.status;
  end if;

  update verifications
  set status = case when approve then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reject_reason = case when approve then null else reason end
  where id = verification_id;

  if approve then
    update profiles
    set is_verified = case when v.kind = 'identity' then true else is_verified end,
        income_verified = case when v.kind = 'income' then true else income_verified end,
        single_cert_verified = case when v.kind = 'single_cert' then true else single_cert_verified end
    where id = v.user_id;
  end if;
end;
$$;

revoke execute on function public.review_verification(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_verification(uuid, boolean, text) to service_role;

-- 4) profiles の変更を Realtime で配信（承認バッジの即時反映用）
alter publication supabase_realtime add table profiles;
