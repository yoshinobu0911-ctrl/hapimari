-- ============================================================
-- ハピマリ 初期スキーマ（SPEC.md §3 データモデル）
-- 全テーブル RLS 有効（SPEC §0-5）
-- ============================================================

-- 3.1 プロフィール（auth.users と 1:1）
create table profiles (
  id uuid primary key references auth.users(id),
  nickname text not null,
  gender text not null check (gender in ('male','female')),
  birth_date date not null, -- 登録時に女性35歳/男性45歳未満を拒否（app側+DB制約）
  prefecture text not null,
  city text,
  marital_history text not null check (marital_history in ('unmarried','divorced','widowed')),
  has_children boolean not null default false,
  children_living_together boolean,
  ok_child_date boolean, -- 子連れデートOK
  marriage_intent text check (marriage_intent in ('asap','within_2y','someday','partner_only')), -- partner_only=籍にこだわらない伴侶
  cohabit_view text,      -- 同居観（自由記述→Phase2で選択式）
  money_view text,
  bio text check (char_length(bio) <= 1000),
  available_times text[] default '{}', -- {'weekday_lunch','weekend_am','weekend_pm','weekday_night'}
  understands_children boolean not null default false, -- 子持ち理解宣言
  understands_remarriage boolean not null default false,
  photo_urls text[] default '{}',
  voice_profile_url text,
  is_verified boolean not null default false, -- F-10 本人確認済み
  income_verified boolean not null default false,
  single_cert_verified boolean not null default false,
  status text not null default 'active' check (status in ('active','suspended','withdrawn')),
  created_at timestamptz default now()
);

-- R1: 登録可能年齢（女性35歳以上・男性45歳以上）。挿入・更新時に評価される
alter table profiles add constraint profiles_min_age_check check (
  (gender = 'female' and birth_date <= (current_date - interval '35 years'))
  or
  (gender = 'male' and birth_date <= (current_date - interval '45 years'))
);

-- 3.2 本人確認申請
create table verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) not null,
  kind text not null check (kind in ('identity','income','single_cert')),
  document_url text not null, -- Storage private bucket
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid, reviewed_at timestamptz, reject_reason text,
  created_at timestamptz default now()
);

-- 3.3 いいね / マッチ
create table likes (
  id uuid primary key default gen_random_uuid(),
  from_user uuid references profiles(id) not null,
  to_user uuid references profiles(id) not null,
  message text check (char_length(message) <= 200),
  created_at timestamptz default now(),
  unique (from_user, to_user)
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid references profiles(id) not null,
  user_b uuid references profiles(id) not null,
  message_count int not null default 0, -- トリガで更新。通話解禁(5往復)・デート打診(10往復)の判定に使用
  call_unlocked boolean generated always as (message_count >= 10) stored, -- 5往復=10メッセージ
  created_at timestamptz default now(),
  unique (user_a, user_b)
);

-- 3.4 メッセージ
create table messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) not null,
  sender uuid references profiles(id) not null,
  body text not null check (char_length(body) <= 2000),
  flagged boolean not null default false, -- F-33 詐欺ワード検知
  created_at timestamptz default now()
);

-- 3.5 デート打診（F-01〜03, F-05）
create table date_proposals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) not null,
  -- 双方の「会ってみたい」意思。両方trueで成立し相手に見える。片方falseでも相手に通知しない
  intent_a boolean, intent_b boolean,
  status text not null default 'collecting'
    check (status in ('collecting','matched','scheduling','confirmed','done','cancelled')),
  proposed_slots jsonb, -- [{date, time_range}] 昼時間帯を優先表示
  confirmed_slot jsonb,
  area_suggestion text, -- 中間エリア名（MVPでは県庁所在地ベースの簡易ロジック）
  feedback_a text check (feedback_a in ('again','end')), -- F-05
  feedback_b text check (feedback_b in ('again','end')),
  created_at timestamptz default now()
);

-- 3.6 通報・警告
create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references profiles(id) not null,
  reported uuid references profiles(id) not null,
  reason text not null,
  detail text,
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at timestamptz default now()
);
-- reported への open通報が3件以上で profiles に警告フラグを立てる（管理画面から手動確定）

-- 3.7 通話ログ（M5）
create table calls (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) not null,
  started_at timestamptz, ended_at timestamptz,
  duration_seconds int, -- 900秒(15分)でクライアント側強制終了
  created_at timestamptz default now()
);

-- 3.8 透明性レポート用の日次集計（F-31）
create table daily_stats (
  date date primary key,
  active_male int, active_female int,
  new_matches int, dates_confirmed int, forced_withdrawals int
);

-- ============================================================
-- インデックス（当事者検索・カウント用）
-- ============================================================
create index idx_likes_to_user_created on likes (to_user, created_at);
create index idx_messages_match_created on messages (match_id, created_at);
create index idx_matches_user_a on matches (user_a);
create index idx_matches_user_b on matches (user_b);
create index idx_verifications_status on verifications (status, created_at);
create index idx_reports_reported_status on reports (reported, status);

-- ============================================================
-- トリガ: messages 挿入で matches.message_count を加算（§3.3）
-- ============================================================
create or replace function public.increment_message_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update matches set message_count = message_count + 1 where id = new.match_id;
  return new;
end;
$$;

create trigger trg_messages_increment_count
after insert on messages
for each row execute function public.increment_message_count();

-- ============================================================
-- RLSヘルパ: 自分がそのマッチの当事者か（RLS内の再帰参照を避けるため security definer）
-- ============================================================
create or replace function public.is_match_participant(target_match uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from matches
    where id = target_match
      and (user_a = auth.uid() or user_b = auth.uid())
  );
$$;

-- ============================================================
-- RLS（SPEC §3 RLS方針）
--   profiles: 本人のみ更新可・認証ユーザーは閲覧可（withdrawn/suspended除外）
--   messages/matches/date_proposals: 当事者のみ
--   verifications/reports の閲覧・更新: service_role のみ（RLSバイパス）
-- ============================================================
alter table profiles enable row level security;
alter table verifications enable row level security;
alter table likes enable row level security;
alter table matches enable row level security;
alter table messages enable row level security;
alter table date_proposals enable row level security;
alter table reports enable row level security;
alter table calls enable row level security;
alter table daily_stats enable row level security;

-- profiles ----------------------------------------------------
create policy "認証ユーザーはactiveプロフィールと自分を閲覧可" on profiles
  for select to authenticated
  using (status = 'active' or id = auth.uid());

create policy "本人のみ作成可" on profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy "本人のみ更新可" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 検証フラグ・status・性別・生年月日はアプリユーザーから直接変更不可（カラム単位で制限）
revoke insert, update on table public.profiles from authenticated;
grant insert (
  id, nickname, gender, birth_date, prefecture, city, marital_history,
  has_children, children_living_together, ok_child_date, marriage_intent,
  cohabit_view, money_view, bio, available_times,
  understands_children, understands_remarriage, photo_urls, voice_profile_url
) on public.profiles to authenticated;
grant update (
  nickname, prefecture, city, marital_history,
  has_children, children_living_together, ok_child_date, marriage_intent,
  cohabit_view, money_view, bio, available_times,
  understands_children, understands_remarriage, photo_urls, voice_profile_url
) on public.profiles to authenticated;

-- verifications ----------------------------------------------
-- 閲覧・更新は service_role のみ（RLSバイパス）。申請の作成のみ本人に許可
create policy "本人のみ申請作成可" on verifications
  for insert to authenticated
  with check (user_id = auth.uid());

revoke update on table public.verifications from authenticated;
grant insert (user_id, kind, document_url) on public.verifications to authenticated;

-- likes -------------------------------------------------------
create policy "自分が送った/もらったいいねを閲覧可" on likes
  for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

-- 挿入は R3/R4 検証のため Edge Function（service_role）経由が正式ルート（M3）。
-- RLSでは自分名義の挿入のみ許可しておく（Edge Function導入時にrevoke検討）
create policy "自分名義のいいねのみ作成可" on likes
  for insert to authenticated
  with check (from_user = auth.uid());

grant insert (from_user, to_user, message) on public.likes to authenticated;

-- matches -----------------------------------------------------
-- 作成・更新はマッチ成立ロジック（service_role / トリガ）のみ。当事者は閲覧のみ
create policy "当事者のみ閲覧可" on matches
  for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

revoke insert, update on table public.matches from authenticated;

-- messages ----------------------------------------------------
create policy "当事者のみ閲覧可" on messages
  for select to authenticated
  using (public.is_match_participant(match_id));

-- R2: 本人確認済み(is_verified)でなければ送信不可
create policy "当事者かつ本人確認済みのみ送信可" on messages
  for insert to authenticated
  with check (
    sender = auth.uid()
    and public.is_match_participant(match_id)
    and exists (
      select 1 from profiles
      where id = auth.uid() and is_verified = true and status = 'active'
    )
  );

grant insert (match_id, sender, body) on public.messages to authenticated;

-- date_proposals ----------------------------------------------
-- R6 の「片方の意思を相手に見せない」制御は M4 でビュー/Edge Function により実装。
-- ベースRLSは当事者のみアクセス可
create policy "当事者のみ閲覧可" on date_proposals
  for select to authenticated
  using (public.is_match_participant(match_id));

create policy "当事者のみ作成可" on date_proposals
  for insert to authenticated
  with check (public.is_match_participant(match_id));

create policy "当事者のみ更新可" on date_proposals
  for update to authenticated
  using (public.is_match_participant(match_id))
  with check (public.is_match_participant(match_id));

-- reports -----------------------------------------------------
-- 閲覧・更新は service_role のみ。作成のみ本人に許可
create policy "本人名義の通報のみ作成可" on reports
  for insert to authenticated
  with check (reporter = auth.uid());

revoke update on table public.reports from authenticated;
grant insert (reporter, reported, reason, detail) on public.reports to authenticated;

-- calls -------------------------------------------------------
create policy "当事者のみ閲覧可" on calls
  for select to authenticated
  using (public.is_match_participant(match_id));

create policy "当事者のみ記録作成可" on calls
  for insert to authenticated
  with check (public.is_match_participant(match_id));

create policy "当事者のみ更新可" on calls
  for update to authenticated
  using (public.is_match_participant(match_id))
  with check (public.is_match_participant(match_id));

-- daily_stats -------------------------------------------------
-- 集計バッチ(pg_cron)と管理画面(service_role)のみ。authenticated へのポリシーなし＝全拒否
