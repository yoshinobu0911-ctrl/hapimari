-- ============================================================
-- M6.7 退会データの保持方針（オーナー承認 A: 2026-07-30）
--
--   ・退会後 90日 は全情報を保持（サポート・紛争対応・復帰のため）
--   ・90日経過後、**個人を特定できる情報をすべて削除**し、
--     アルゴリズム学習用の**特徴量だけ**を匿名IDのまま無期限で残す
--     （写真・本人確認書類・自己紹介原文・メッセージ本文・座標は削除）
--   ・メールアドレスのハッシュだけを台帳として無期限保持し、以下に使う
--       ①配信除外（サプレッション）②再登録の禁止（強制退会者）
--       ③ブロックの引き継ぎ ④通報履歴の引き継ぎ
--   ・自主退会者の再登録は可。ただし **退会から7日間はクーリング期間**。
--     短い期間の弱点（通報リセット）は④の引き継ぎで補う。
--
-- 匿名化の要点: 台帳（メールハッシュ）と特徴量レコードを**相互に紐付けない**。
--   紐付けると「メールアドレスを知っていれば特徴量を再特定できる」ため匿名化が崩れる。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 保持ポリシーの定数と、profiles への管理列
-- ------------------------------------------------------------
alter table profiles add column if not exists withdrawn_at timestamptz;    -- 退会日時（90日判定の起点）
alter table profiles add column if not exists anonymized_at timestamptz;   -- 匿名化の完了日時
alter table profiles add column if not exists age_band text;               -- 匿名化後に残す年齢帯（例 '45-49'）
alter table profiles add column if not exists region_block text;           -- 匿名化後に残す地域ブロック（例 '関東'）
alter table profiles add column if not exists bio_features jsonb;          -- 自己紹介文の派生特徴量（原文は残さない）
alter table profiles add column if not exists prior_report_count int not null default 0; -- 引き継いだ通報数

comment on column profiles.age_band is '匿名化後の学習用。生年月日は削除される';
comment on column profiles.bio_features is '文字数・記号率など、原文に戻せない派生値のみ';

-- ------------------------------------------------------------
-- 1. メールアドレスのハッシュ台帳（無期限・特徴量とは紐付けない）
-- ------------------------------------------------------------
create table if not exists identity_ledger (
  email_hash text primary key,                -- sha256(小文字化・trim したメールアドレス)
  banned boolean not null default false,      -- 強制退会 = 永久に再登録不可
  ban_reason text,
  suppressed boolean not null default false,  -- 配信除外（再登録で解除）
  report_count int not null default 0,        -- 通報履歴の引き継ぎ（クーリング短縮の補償）
  last_withdrawn_at timestamptz,              -- 直近の退会日時（クーリング判定）
  withdrawal_count int not null default 0,    -- 退会の回数（繰り返し悪用の検知用）
  updated_at timestamptz not null default now()
);
alter table identity_ledger enable row level security; -- ポリシー無し = 利用者からは不可視
grant all on identity_ledger to service_role;
revoke truncate, references, trigger on identity_ledger from anon, authenticated;

-- ブロックの引き継ぎ（ハッシュ同士で保持。特徴量とは無関係）
create table if not exists block_carryover (
  blocker_hash text not null,
  blocked_hash text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_hash, blocked_hash)
);
alter table block_carryover enable row level security;
grant all on block_carryover to service_role;
revoke truncate, references, trigger on block_carryover from anon, authenticated;

-- 削除待ちファイルのキュー（Storage API 経由で消すため）
create table if not exists file_deletion_queue (
  bucket_id text not null,
  path text not null,
  enqueued_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (bucket_id, path)
);
alter table file_deletion_queue enable row level security;
grant all on file_deletion_queue to service_role;
revoke truncate, references, trigger on file_deletion_queue from anon, authenticated;

create or replace function public.get_pending_file_deletions()
returns table(bucket_id text, path text)
language sql stable security definer set search_path = public as $$
  select q.bucket_id, q.path from file_deletion_queue q where q.deleted_at is null;
$$;
revoke execute on function public.get_pending_file_deletions() from public, anon, authenticated;
grant execute on function public.get_pending_file_deletions() to service_role;

create or replace function public.mark_file_deleted(p_bucket text, p_path text)
returns void
language sql volatile security definer set search_path = public as $$
  update file_deletion_queue set deleted_at = now()
  where bucket_id = p_bucket and path = p_path;
$$;
revoke execute on function public.mark_file_deleted(text, text) from public, anon, authenticated;
grant execute on function public.mark_file_deleted(text, text) to service_role;

-- ------------------------------------------------------------
-- 2. ハッシュ生成
--    広告プラットフォーム（Meta/Google のカスタムオーディエンス）と同じ
--    「小文字化・前後空白除去した文字列の sha256」に揃える。
--    ※ これは秘密値ではなく仮名化識別子。台帳には他の個人情報を置かない。
-- ------------------------------------------------------------
create or replace function public._email_hash(p_email text)
returns text
language sql immutable as $$
  select encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex');
$$;

create or replace function public._email_hash_of(p_user uuid)
returns text
language sql stable security definer set search_path = public, auth as $$
  select public._email_hash(u.email) from auth.users u where u.id = p_user and u.email is not null;
$$;
revoke execute on function public._email_hash_of(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. 退会処理の拡張
--    退会時に「台帳へ記録」「ブロック関係をハッシュで退避」を行う。
-- ------------------------------------------------------------
create or replace function public._record_withdrawal(p_user uuid, p_banned boolean, p_reason text)
returns void
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  h text := public._email_hash_of(p_user);
  rc int;
begin
  if h is null then
    return; -- メール未設定（想定外）の場合は台帳を作らない
  end if;

  select count(*) into rc from reports where reported = p_user;

  insert into identity_ledger (email_hash, banned, ban_reason, suppressed, report_count,
                               last_withdrawn_at, withdrawal_count)
  values (h, p_banned, p_reason, true, rc, now(), 1)
  on conflict (email_hash) do update set
    banned = identity_ledger.banned or excluded.banned,
    ban_reason = coalesce(excluded.ban_reason, identity_ledger.ban_reason),
    suppressed = true,
    report_count = greatest(identity_ledger.report_count, excluded.report_count),
    last_withdrawn_at = now(),
    withdrawal_count = identity_ledger.withdrawal_count + 1,
    updated_at = now();

  -- ブロック関係をハッシュ対で退避（相手が在籍中でもハッシュは算出できる）
  insert into block_carryover (blocker_hash, blocked_hash)
    select public._email_hash_of(b.blocker), public._email_hash_of(b.blocked)
    from blocks b
    where (b.blocker = p_user or b.blocked = p_user)
      and public._email_hash_of(b.blocker) is not null
      and public._email_hash_of(b.blocked) is not null
  on conflict do nothing;

  -- 退会した時点で認証アカウントと本人の結び付きを断つ。
  --   ・メールアドレスを無効値に置き換えることで、同じアドレスでの**再登録を可能にする**
  --     （再登録は常に新規アカウント扱いになり、過去データは復活しない＝設計方針どおり）
  --   ・発行済みトークンを失効させ、退会後の操作を止める
  --   ・以降このユーザー行は「学習用の匿名レコード」へ向かうだけで、本人には戻せない
  update auth.users set
    email = 'withdrawn-' || p_user::text || '@invalid',
    phone = null,
    raw_user_meta_data = '{}'::jsonb,
    banned_until = 'infinity'
  where id = p_user;
end $$;
revoke execute on function public._record_withdrawal(uuid, boolean, text) from public, anon, authenticated;

create or replace function public.withdraw_account()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  update profiles set status = 'withdrawn', withdrawn_at = now()
  where id = auth.uid() and status <> 'withdrawn';
  if not found then
    raise exception 'not_registered';
  end if;
  perform public._record_withdrawal(auth.uid(), false, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- 管理画面からの強制退会（永久に再登録不可）
create or replace function public.ban_account(p_user uuid, p_reason text)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  update profiles set status = 'withdrawn', withdrawn_at = now() where id = p_user;
  perform public._record_withdrawal(p_user, true, p_reason);
end $$;
revoke execute on function public.ban_account(uuid, text) from public, anon, authenticated;
grant execute on function public.ban_account(uuid, text) to service_role;

-- ------------------------------------------------------------
-- 4. 再登録の判定（プロフィール作成時に強制）
--    ※ 匿名ユーザーに「このメールは登録済みか」を答えるRPCは作らない。
--      （メールアドレスの存在確認オラクルになりプライバシー漏えいになるため）
--      認証済みの本人がプロフィールを作る瞬間に判定する。
-- ------------------------------------------------------------
create or replace function public._enforce_registration_eligibility()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  h text;
  led identity_ledger;
begin
  if auth.uid() is null then
    return new; -- seed / service_role による投入は対象外
  end if;
  h := public._email_hash_of(new.id);
  if h is null then
    return new;
  end if;

  select * into led from identity_ledger where email_hash = h;
  if led.email_hash is null then
    return new; -- 初回登録
  end if;

  if led.banned then
    raise exception 'registration_banned';
  end if;
  -- クーリング期間（7日）: 退会→即再登録による各種リセットの抑止
  if led.last_withdrawn_at is not null
     and led.last_withdrawn_at > now() - interval '7 days' then
    raise exception 'registration_cooling';
  end if;

  -- 通報履歴を引き継ぐ（クーリングが短くても「通報リセット」が成立しないようにする）
  new.prior_report_count := led.report_count;
  return new;
end $$;
drop trigger if exists trg_enforce_registration_eligibility on profiles;
create trigger trg_enforce_registration_eligibility before insert on profiles
  for each row execute function public._enforce_registration_eligibility();

-- 再登録後: 配信除外を解除し、過去のブロック関係を復元する
create or replace function public._restore_after_reregistration()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  h text;
begin
  if auth.uid() is null then
    return new;
  end if;
  h := public._email_hash_of(new.id);
  if h is null then
    return new;
  end if;

  -- 再登録＝改めて同意を得たので配信除外を解除
  update identity_ledger set suppressed = false, updated_at = now() where email_hash = h;

  -- 過去のブロックを復元（相手が現在も在籍している場合のみ）
  insert into blocks (blocker, blocked)
    select new.id, p.id
    from block_carryover bc
    join profiles p on p.status = 'active' and public._email_hash_of(p.id) = bc.blocked_hash
    where bc.blocker_hash = h and p.id <> new.id
  on conflict do nothing;

  insert into blocks (blocker, blocked)
    select p.id, new.id
    from block_carryover bc
    join profiles p on p.status = 'active' and public._email_hash_of(p.id) = bc.blocker_hash
    where bc.blocked_hash = h and p.id <> new.id
  on conflict do nothing;

  return new;
end $$;
drop trigger if exists trg_restore_after_reregistration on profiles;
create trigger trg_restore_after_reregistration after insert on profiles
  for each row execute function public._restore_after_reregistration();

-- ------------------------------------------------------------
-- 5. 90日経過後の匿名化（特徴量だけ残す）
--    ・profiles の行は削除しない（削除するとマッチ・デート・通話の関係が壊れ、
--      学習データが失われるため）。個人を特定できる列を消し、匿名IDとして残す。
--    ・写真・本人確認書類・メッセージ本文・座標は削除する。
-- ------------------------------------------------------------
create or replace function public._age_band(p_birth date)
returns text
language sql immutable as $$
  select case
    when p_birth is null then null
    else (floor(date_part('year', age(p_birth)) / 5) * 5)::int || '-'
         || ((floor(date_part('year', age(p_birth)) / 5) * 5)::int + 4)
  end;
$$;

create or replace function public._region_block(p_pref text)
returns text
language sql immutable as $$
  select case
    when p_pref in ('北海道') then '北海道'
    when p_pref in ('青森県','岩手県','宮城県','秋田県','山形県','福島県') then '東北'
    when p_pref in ('茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県') then '関東'
    when p_pref in ('新潟県','富山県','石川県','福井県','山梨県','長野県') then '北陸甲信越'
    when p_pref in ('岐阜県','静岡県','愛知県','三重県') then '東海'
    when p_pref in ('滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県') then '関西'
    when p_pref in ('鳥取県','島根県','岡山県','広島県','山口県') then '中国'
    when p_pref in ('徳島県','香川県','愛媛県','高知県') then '四国'
    when p_pref in ('福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県') then '九州'
    when p_pref in ('沖縄県') then '沖縄'
    else 'その他' end;
$$;

-- 自己紹介文から原文に戻せない派生特徴量だけを作る
create or replace function public._bio_features(p_bio text)
returns jsonb
language sql immutable as $$
  select case when p_bio is null then '{}'::jsonb else jsonb_build_object(
    'length', char_length(p_bio),
    'lines', array_length(string_to_array(p_bio, E'\n'), 1),
    -- 1文字あたりのバイト数。絵文字・記号が多い文ほど大きくなる（原文には戻せない）
    'multibyte_ratio', round((octet_length(p_bio)::numeric / greatest(char_length(p_bio), 1)), 2),
    'question_marks', char_length(p_bio) - char_length(replace(p_bio, '？', '')),
    'mentions_hobby', p_bio ~ '(趣味|旅行|映画|料理|散歩|温泉)',
    'mentions_marriage', p_bio ~ '(結婚|再婚|パートナー|将来)'
  ) end;
$$;

-- 匿名化の本体（1ユーザー分）
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

-- 90日を過ぎた退会者をまとめて匿名化する定期実行用ジョブ
create or replace function public.run_retention_job()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  target uuid;
  n int := 0;
begin
  for target in
    select id from profiles
    where status = 'withdrawn'
      and anonymized_at is null
      and withdrawn_at is not null
      and withdrawn_at < now() - interval '90 days'
  loop
    perform public.anonymize_profile(target);
    n := n + 1;
  end loop;
  return jsonb_build_object('anonymized', n, 'ran_at', now());
end $$;
revoke execute on function public.run_retention_job() from public, anon, authenticated;
grant execute on function public.run_retention_job() to service_role;

-- 匿名化済みの行は年齢制約の対象外にする（1900-01-01 を許容）
alter table profiles drop constraint if exists profiles_min_age_check;
alter table profiles add constraint profiles_min_age_check check (
  anonymized_at is not null
  or birth_date <= (current_date - interval '35 years')
);

-- ------------------------------------------------------------
-- 6. 配信除外リストの取り出し（CRM・広告のカスタムオーディエンス用）
--    メールアドレスのハッシュのみを返す。個人情報は含まない。
-- ------------------------------------------------------------
create or replace function public.get_suppression_list()
returns table(email_hash text)
language sql stable security definer set search_path = public as $$
  select l.email_hash from identity_ledger l where l.suppressed or l.banned;
$$;
revoke execute on function public.get_suppression_list() from public, anon, authenticated;
grant execute on function public.get_suppression_list() to service_role;
