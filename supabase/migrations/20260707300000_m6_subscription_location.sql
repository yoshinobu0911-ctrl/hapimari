-- ============================================================
-- M6: 課金モック・R9・退会・daily_stats・距離マッチング
-- 設計書: docs/design/M6_design.md（判断10点 2026-07-07 オーナー承認済み）
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles: 課金フラグ + 位置情報（丸め保存）
-- ------------------------------------------------------------
alter table profiles add column subscription_active boolean not null default false;
alter table profiles add column loc_lat double precision;
alter table profiles add column loc_lng double precision;
alter table profiles add column loc_updated_at timestamptz;

-- 座標はDB側でも必ず約1km単位（小数第2位）に丸める（プライバシー原則1）
create or replace function public.round_profile_location()
returns trigger
language plpgsql
as $$
begin
  if new.loc_lat is not null then
    new.loc_lat := round(new.loc_lat::numeric, 2)::double precision;
  end if;
  if new.loc_lng is not null then
    new.loc_lng := round(new.loc_lng::numeric, 2)::double precision;
  end if;
  if new.loc_lat is distinct from old.loc_lat or new.loc_lng is distinct from old.loc_lng then
    new.loc_updated_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_profiles_round_loc
before update of loc_lat, loc_lng on profiles
for each row execute function public.round_profile_location();

-- ------------------------------------------------------------
-- 2. 座標を他ユーザーから遮断（プライバシー原則2・カラム単位GRANT）
--    SELECT をテーブル単位から「loc系を除く明示列」に切り替える
-- ------------------------------------------------------------
revoke select on table public.profiles from authenticated;
grant select (
  id, nickname, gender, birth_date, prefecture, city, marital_history,
  has_children, children_living_together, ok_child_date, marriage_intent,
  cohabit_view, money_view, bio, available_times,
  understands_children, understands_remarriage, photo_urls, voice_profile_url,
  is_verified, income_verified, single_cert_verified, status, created_at,
  value_tags, subscription_active
) on public.profiles to authenticated;

-- 自分の位置は更新できる（読み取りは不要: 端末が知っている）
grant update (loc_lat, loc_lng) on public.profiles to authenticated;

-- ------------------------------------------------------------
-- 3. R9: 男性は subscription_active=false ならメッセージ送信不可（RLS）
-- ------------------------------------------------------------
drop policy "当事者かつ本人確認済みのみ送信可" on messages;
create policy "当事者・本人確認済み・男性は課金済みのみ送信可" on messages
  for insert to authenticated
  with check (
    sender = auth.uid()
    and public.is_match_participant(match_id)
    and exists (
      select 1 from profiles
      where id = auth.uid() and is_verified = true and status = 'active'
        and (gender = 'female' or subscription_active = true)
    )
  );

-- ------------------------------------------------------------
-- 4. RPC: モック課金（常に成功・MVP）
-- ------------------------------------------------------------
create or replace function public.purchase_subscription(p_plan text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  g text;
begin
  if p_plan <> 'male_standard' then
    -- female_premium は将来枠（available=false）。ここでは受け付けない
    raise exception 'invalid_plan';
  end if;
  select gender into g from profiles where id = auth.uid();
  if g is null then
    raise exception 'not_registered';
  end if;
  if g = 'female' then
    raise exception 'not_required'; -- 女性は現在無料
  end if;
  update profiles set subscription_active = true where id = auth.uid();
  return jsonb_build_object('ok', true, 'plan', p_plan);
end;
$$;
revoke execute on function public.purchase_subscription(text) from public, anon;
grant execute on function public.purchase_subscription(text) to authenticated, service_role;

-- ------------------------------------------------------------
-- 5. RPC: 退会（ソフトデリート・判断#6）
--    status はクライアント直接更新不可のためRPC経由。以後RLSにより他人から完全非表示
-- ------------------------------------------------------------
create or replace function public.withdraw_account()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
begin
  update profiles set status = 'withdrawn' where id = auth.uid();
  if not found then
    raise exception 'not_registered';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.withdraw_account() from public, anon;
grant execute on function public.withdraw_account() to authenticated, service_role;

-- ------------------------------------------------------------
-- 6. 距離（ハバーサイン）とバッチ距離RPC（プライバシー原則2: 距離のみ開示）
-- ------------------------------------------------------------
create or replace function public._distance_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;
revoke execute on function public._distance_km(double precision, double precision, double precision, double precision) from public, anon;

-- 自分→相手たちの丸め距離(km)を返す。自分が位置未許可なら空（距離機能なし・オーナー決定）
create or replace function public.get_profile_distances(p_user_ids uuid[])
returns table(user_id uuid, distance_km integer)
language plpgsql stable security definer set search_path = public as $$
declare
  my_lat double precision;
  my_lng double precision;
begin
  select loc_lat, loc_lng into my_lat, my_lng from profiles where id = auth.uid();
  if my_lat is null or my_lng is null then
    return;
  end if;
  return query
    select p.id, greatest(0, round(public._distance_km(my_lat, my_lng, p.loc_lat, p.loc_lng)))::int
    from profiles p
    where p.id = any(p_user_ids)
      and p.loc_lat is not null and p.loc_lng is not null;
end;
$$;
revoke execute on function public.get_profile_distances(uuid[]) from public, anon;
grant execute on function public.get_profile_distances(uuid[]) to authenticated, service_role;

-- ------------------------------------------------------------
-- 7. daily_stats 集計（透明性レポートの元データ）
--    注: 確定日・凍結日のタイムスタンプ列が無いため、dates_confirmed は
--    「confirmed_slot の日付=当日」、forced_withdrawals は「現在凍結中の累計」を
--    近似値として使う（QUESTIONS.md に記録・委託レビュー対象）
-- ------------------------------------------------------------
create or replace function public.compute_daily_stats(p_date date)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  insert into daily_stats (date, active_male, active_female, new_matches, dates_confirmed, forced_withdrawals)
  values (
    p_date,
    (select count(*) from profiles where gender = 'male' and status = 'active'),
    (select count(*) from profiles where gender = 'female' and status = 'active'),
    (select count(*) from matches where (created_at at time zone 'Asia/Tokyo')::date = p_date),
    (select count(*) from date_proposals
      where status in ('confirmed', 'done') and (confirmed_slot ->> 'date')::date = p_date),
    (select count(*) from profiles where status = 'suspended')
  )
  on conflict (date) do update set
    active_male = excluded.active_male,
    active_female = excluded.active_female,
    new_matches = excluded.new_matches,
    dates_confirmed = excluded.dates_confirmed,
    forced_withdrawals = excluded.forced_withdrawals;
end;
$$;
revoke execute on function public.compute_daily_stats(date) from public, anon, authenticated;
grant execute on function public.compute_daily_stats(date) to service_role;

-- pg_cron: 毎日 0:05 JST（15:05 UTC）に前日分を集計（判断#3。拡張が使えない環境では手動ボタンのみ）
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'hapimari-daily-stats',
    '5 15 * * *',
    $job$select public.compute_daily_stats(((now() at time zone 'Asia/Tokyo')::date - 1));$job$
  );
exception when others then
  raise notice 'pg_cron の設定をスキップしました（手動集計ボタンで代替）: %', sqlerrm;
end;
$$;
