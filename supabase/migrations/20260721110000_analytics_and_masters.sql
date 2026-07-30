-- ============================================================
-- DB設計レビュー対応（オーナー承認 A: 2026-07-21）
--
--   1. イベントログ user_events を新設（append-only・行動履歴＝後から取り返せない資産）
--   2. 状態遷移タイムスタンプ（date_proposals に遷移時刻・実施日を列として昇格）
--   3. 価値観タグ/時間帯のマスタ表 + 不正値検証 + GINインデックス
--   4. 小粒（メール不達フラグ・索引補強）
--
-- 方針: 既存テーブルの作り替えはしない（追加のみ）。埋め込み配列と中間テーブルの
--       二重持ちはしない（マスタは「辞書」であり関係は配列側が正）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. イベントログ（行動履歴）
--    ・append-only。プロダクトの「今の状態」とは分離して持つ
--    ・authenticated には一切の権限を与えない（読み書きとも不可）。
--      書き込みはトリガ or security definer RPC 経由のみ。分析は service_role。
-- ------------------------------------------------------------
create table user_events (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references profiles(id),        -- 行為者（システム起因は null）
  event_type text not null,                     -- 種別（下記 CHECK の語彙）
  target_user_id uuid references profiles(id),  -- 相手（あれば）
  match_id uuid references matches(id),
  props jsonb not null default '{}'::jsonb,     -- 付帯情報
  constraint user_events_type_check check (event_type in (
    -- クライアント発（RPC経由）
    'profile_view', 'discover_impression', 'filter_applied',
    -- サーバー発（トリガ）
    'like_sent', 'match_created', 'message_sent', 'call_logged',
    'date_started', 'date_status_changed',
    'report_created', 'block_created'
  ))
);

alter table user_events enable row level security; -- ポリシー無し = authenticated は不可視
grant all on table user_events to service_role;
grant usage, select on sequence user_events_id_seq to service_role;

-- 分析用インデックス（時系列 / 行為者別 / 種別別）
create index idx_user_events_occurred on user_events (occurred_at);
create index idx_user_events_actor on user_events (actor_id, occurred_at);
create index idx_user_events_type on user_events (event_type, occurred_at);

-- 内部用の記録ヘルパ（トリガから呼ぶ）
create or replace function public._log_event(
  p_actor uuid, p_type text, p_target uuid, p_match uuid, p_props jsonb
) returns void
language sql volatile security definer set search_path = public as $$
  insert into user_events (actor_id, event_type, target_user_id, match_id, props)
  values (p_actor, p_type, p_target, p_match, coalesce(p_props, '{}'::jsonb));
$$;
revoke execute on function public._log_event(uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;

-- クライアント発イベントの記録RPC
--   ・actor は必ず auth.uid()（なりすまし不可）
--   ・記録できる種別をクライアント発のものだけに限定（ログ汚染の防止）
create or replace function public.log_user_event(
  p_event_type text,
  p_target_user_id uuid default null,
  p_props jsonb default '{}'::jsonb
) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  if p_event_type not in ('profile_view', 'discover_impression', 'filter_applied') then
    raise exception 'invalid_event_type';
  end if;
  -- 付帯情報のサイズ制限（肥大化防止）
  if length(p_props::text) > 2000 then
    raise exception 'props_too_large';
  end if;
  perform public._log_event(auth.uid(), p_event_type, p_target_user_id, null, p_props);
end $$;
revoke execute on function public.log_user_event(text, uuid, jsonb) from public, anon;
grant execute on function public.log_user_event(text, uuid, jsonb) to authenticated, service_role;

-- --- サーバー発イベント（トリガ）: クライアント改修なしで確実に記録される ---

create or replace function public._ev_like() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._log_event(new.from_user, 'like_sent', new.to_user, null,
    jsonb_build_object('has_message', new.message is not null));
  return new;
end $$;
create trigger trg_ev_like after insert on likes
  for each row execute function public._ev_like();

create or replace function public._ev_match() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._log_event(new.user_a, 'match_created', new.user_b, new.id, '{}'::jsonb);
  return new;
end $$;
create trigger trg_ev_match after insert on matches
  for each row execute function public._ev_match();

create or replace function public._ev_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._log_event(new.sender, 'message_sent', null, new.match_id,
    jsonb_build_object('length', char_length(new.body), 'flagged', new.flagged));
  return new;
end $$;
create trigger trg_ev_message after insert on messages
  for each row execute function public._ev_message();

create or replace function public._ev_call() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._log_event(null, 'call_logged', null, new.match_id,
    jsonb_build_object('duration_seconds', new.duration_seconds));
  return new;
end $$;
create trigger trg_ev_call after insert on calls
  for each row execute function public._ev_call();

create or replace function public._ev_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._log_event(new.reporter, 'report_created', new.reported, null,
    jsonb_build_object('reason', new.reason));
  return new;
end $$;
create trigger trg_ev_report after insert on reports
  for each row execute function public._ev_report();

create or replace function public._ev_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._log_event(new.blocker, 'block_created', new.blocked, null, '{}'::jsonb);
  return new;
end $$;
create trigger trg_ev_block after insert on blocks
  for each row execute function public._ev_block();

-- ------------------------------------------------------------
-- 2. 状態遷移タイムスタンプ（ファネル分析をSQLで書けるようにする）
--    デート実施日は jsonb 内から date 列へ昇格
-- ------------------------------------------------------------
alter table date_proposals
  add column intent_matched_at timestamptz,  -- 両者が「会ってみたい」になった時刻
  add column first_proposed_at timestamptz,  -- 最初の日程提案
  add column confirmed_at timestamptz,       -- 日程確定
  add column date_on date,                   -- デート実施予定日（confirmed_slot から昇格）
  add column cancelled_at timestamptz,
  add column done_at timestamptz;

-- 既存行のバックフィル（時刻は不明なため created_at で近似・日付は jsonb から復元）
update date_proposals set
  date_on = nullif(confirmed_slot ->> 'date', '')::date
where confirmed_slot is not null;
update date_proposals set confirmed_at = created_at
  where status in ('confirmed', 'done') and confirmed_at is null;
update date_proposals set intent_matched_at = created_at
  where status <> 'collecting' and intent_matched_at is null;
update date_proposals set done_at = created_at where status = 'done' and done_at is null;
update date_proposals set cancelled_at = created_at where status = 'cancelled' and cancelled_at is null;

-- 遷移時刻の自動スタンプ（RPC群には手を入れず、状態変化を1か所で捉える）
create or replace function public._stamp_date_transitions() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'matched' and new.intent_matched_at is null then
      new.intent_matched_at := now();
    elsif new.status = 'scheduling' and new.first_proposed_at is null then
      new.first_proposed_at := now();
    elsif new.status = 'confirmed' then
      new.confirmed_at := now();
    elsif new.status = 'cancelled' then
      new.cancelled_at := now();
    elsif new.status = 'done' then
      new.done_at := now();
    end if;
  end if;
  -- 確定枠が入れ替わったら実施予定日も追随
  if new.confirmed_slot is distinct from old.confirmed_slot then
    new.date_on := nullif(new.confirmed_slot ->> 'date', '')::date;
  end if;
  return new;
end $$;
create trigger trg_stamp_date_transitions before update on date_proposals
  for each row execute function public._stamp_date_transitions();

-- 状態遷移イベントもログへ
create or replace function public._ev_date() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public._log_event(null, 'date_started', null, new.match_id, '{}'::jsonb);
  elsif new.status is distinct from old.status then
    perform public._log_event(null, 'date_status_changed', null, new.match_id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;
create trigger trg_ev_date after insert or update on date_proposals
  for each row execute function public._ev_date();

create index idx_date_proposals_date_on on date_proposals (date_on);

-- ------------------------------------------------------------
-- 3. マスタ表（辞書）+ 不正値検証 + GINインデックス
--    ・関係の「正」は profiles の配列のまま（二重持ちしない）
--    ・マスタは表記ゆれ・不正値の防止と、管理画面/分析からの参照用
--    ・辞書の正本は packages/shared/src/value_tags.ts / constants.ts。
--      タグを増やす時は TS とこのマスタの両方に追加すること。
-- ------------------------------------------------------------
create table value_tag_master (
  id text primary key,
  label text not null,
  category text not null,
  sort_order int not null,
  active boolean not null default true
);
create table available_time_master (
  value text primary key,
  label text not null,
  sort_order int not null
);
alter table value_tag_master enable row level security;
alter table available_time_master enable row level security;
create policy "誰でも辞書を閲覧可" on value_tag_master for select to authenticated using (true);
create policy "誰でも辞書を閲覧可" on available_time_master for select to authenticated using (true);
grant select on value_tag_master, available_time_master to authenticated;
grant all on value_tag_master, available_time_master to service_role;

insert into value_tag_master (id, label, category, sort_order) values
  ('family_no_seki',      '籍にこだわらない',                 'family',    1),
  ('family_soon',         '早めに一緒になりたい',             'family',    2),
  ('family_kids_like',    '子どもが好き',                     'family',    3),
  ('family_respect_kids', 'お相手のお子さまを大切にしたい',   'family',    4),
  ('family_time',         '家族との時間を大切にしたい',       'family',    5),
  ('family_pet',          'ペットも家族',                     'family',    6),
  ('money_sense',         '金銭感覚が合う人がいい',           'money',     7),
  ('money_steady',        '老後を見据えて計画的に',           'money',     8),
  ('money_dual',          '共働きでもOK',                     'money',     9),
  ('money_simple',        '質素でも心豊かに',                 'money',    10),
  ('living_flex',         '同居にこだわらない',               'living',   11),
  ('living_weekend',      '週末婚もあり',                     'living',   12),
  ('living_local',        '地元を離れたくない',               'living',   13),
  ('living_country',      '田舎暮らしに憧れる',               'living',   14),
  ('comm_frequent',       '連絡はまめに',                     'comm',     15),
  ('comm_mypace',         '連絡はマイペース',                 'comm',     16),
  ('comm_lunch',          'まずはランチから',                 'comm',     17),
  ('comm_slow',           'ゆっくり距離を縮めたい',           'comm',     18),
  ('comm_meet',           'メッセージより会って話したい',     'comm',     19),
  ('hobby_together',      '休日は一緒に過ごしたい',           'hobby',    20),
  ('hobby_own_time',      'お互いの時間も大切に',             'hobby',    21),
  ('hobby_travel',        '旅行が好き',                       'hobby',    22),
  ('hobby_cooking',       '料理が好き',                       'hobby',    23),
  ('hobby_walk',          '散歩・ウォーキングが好き',         'hobby',    24),
  ('hobby_onsen',         '温泉が好き',                       'hobby',    25),
  ('hobby_movie',         '映画・ドラマが好き',               'hobby',    26),
  ('char_listener',       '聞き上手といわれる',               'character',27),
  ('char_humor',          '笑いのツボが合う人がいい',         'character',28),
  ('char_thanks',         '感謝を言葉にしたい',               'character',29),
  ('char_calm',           '穏やかに過ごしたい',               'character',30);

insert into available_time_master (value, label, sort_order) values
  ('weekday_lunch', '平日ランチ',   1),
  ('weekend_am',    '週末の午前',   2),
  ('weekend_pm',    '週末の午後',   3),
  ('weekday_night', '平日の夜',     4);

-- 配列にマスタ外の値が入るのを防ぐ（表記ゆれ・不正値の封じ込め）
create or replace function public._validate_profile_arrays() returns trigger
language plpgsql set search_path = public as $$
declare
  bad text;
begin
  select t into bad from unnest(new.value_tags) as t
  where t not in (select id from value_tag_master where active) limit 1;
  if bad is not null then
    raise exception 'unknown_value_tag: %', bad;
  end if;

  select t into bad from unnest(new.available_times) as t
  where t not in (select value from available_time_master) limit 1;
  if bad is not null then
    raise exception 'unknown_available_time: %', bad;
  end if;

  return new;
end $$;
create trigger trg_validate_profile_arrays before insert or update on profiles
  for each row execute function public._validate_profile_arrays();

-- 配列検索を高速化（「このタグを持つ人」の抽出。中間テーブル無しでも高速に引ける）
create index idx_profiles_value_tags on profiles using gin (value_tags);
create index idx_profiles_available_times on profiles using gin (available_times);

-- ------------------------------------------------------------
-- 4. 小粒（メール不達フラグ・索引補強）
-- ------------------------------------------------------------
alter table profiles add column email_bounced boolean not null default false;

create index idx_likes_from_user_created on likes (from_user, created_at);
create index idx_blocks_blocked on blocks (blocked);
-- discover の主要条件（有効・性別・年齢）を1本で拾う
create index idx_profiles_status_gender_birth on profiles (status, gender, birth_date);

-- 新規テーブルの過剰権限を剥奪（TRUNCATE は RLS を迂回するため authenticated には渡さない）
revoke truncate, references, trigger on user_events, value_tag_master, available_time_master
  from anon, authenticated;
