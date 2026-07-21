-- ============================================================
-- M6.5 セキュリティ強化スプリント P1（docs/design/M6_5_security_design.md）
-- PR #1 レビュー指摘（boooleonardo / satoman0703）への対応・オーナー承認済み
--
--   1. profiles_public ビュー: 他人に見せるのは公開項目+計算済み年齢のみ
--      （birth_date・子ども関連・理解宣言・subscription_active を秘匿）
--   2. profiles 本体の SELECT は本人の行のみに変更
--   3. ブロックの全アクション遮断（messages / calls / date系RPC）
--   4. 距離の三点測位対策: 帯域化 + ペア固定ジッター + 対象限定
--   5. set_my_location の更新制限（30分間隔・1日8回）
--   6. review_verification に reviewed_by 記録（管理者ID導入までは呼び出し側任意）
--   7. 写真の事前審査テーブル photo_reviews（バケット非公開化はP2でクライアントと同時切替）
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles_public ビュー（security definer 相当・所有者経由でRLSを代替する
--    アクセス制御をWHERE句に内蔵。他人のプロフィール取得はすべてこのビュー経由）
-- ------------------------------------------------------------
create view public.profiles_public as
select
  id,
  nickname,
  gender,
  (date_part('year', age(birth_date)))::int as age, -- 誕生日そのものは出さない
  prefecture,
  city,
  marital_history,
  marriage_intent,
  cohabit_view,
  money_view,
  bio,
  available_times,
  value_tags,
  photo_urls,
  is_verified,
  income_verified,
  single_cert_verified,
  status,
  created_at
from profiles
where
  id = auth.uid()
  or (status = 'active' and not public.is_blocked_between(auth.uid(), id));

grant select on public.profiles_public to authenticated;
grant select on public.profiles_public to service_role;

-- 2. profiles 本体は本人の行のみ閲覧可（自分の設定表示・R9判定用）
drop policy "認証ユーザーはactiveかつ非ブロックのプロフィールと自分を閲覧可" on profiles;
create policy "本人のみ閲覧可" on profiles
  for select to authenticated
  using (id = auth.uid());

-- ------------------------------------------------------------
-- 3. ブロックの全アクション遮断
-- ------------------------------------------------------------
create or replace function public.is_match_blocked(target_match uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matches m
    where m.id = target_match
      and public.is_blocked_between(m.user_a, m.user_b)
  );
$$;
revoke execute on function public.is_match_blocked(uuid) from public, anon;
grant execute on function public.is_match_blocked(uuid) to authenticated, service_role;

-- メッセージ送信: ブロック済みペアは拒否
drop policy "当事者・本人確認済み・男性は課金済みのみ送信可" on messages;
create policy "当事者・本人確認済み・非ブロック・男性は課金済みのみ送信可" on messages
  for insert to authenticated
  with check (
    sender = auth.uid()
    and public.is_match_participant(match_id)
    and not public.is_match_blocked(match_id)
    and exists (
      select 1 from profiles
      where id = auth.uid() and is_verified = true and status = 'active'
        and (gender = 'female' or subscription_active = true)
    )
  );

-- 通話記録: ブロック済みペアは拒否
drop policy "当事者のみ記録作成可" on calls;
create policy "当事者かつ非ブロックのみ記録作成可" on calls
  for insert to authenticated
  with check (
    public.is_match_participant(match_id)
    and not public.is_match_blocked(match_id)
  );

-- デート系RPCの共通入口にブロック検証を追加
create or replace function public._date_get_match(p_match_id uuid)
returns matches
language plpgsql stable security definer set search_path = public as $$
declare
  m matches;
begin
  select * into m from matches where id = p_match_id;
  if m.id is null or (m.user_a <> auth.uid() and m.user_b <> auth.uid()) then
    raise exception 'not_participant';
  end if;
  if public.is_blocked_between(m.user_a, m.user_b) then
    raise exception 'blocked';
  end if;
  return m;
end $$;

-- ------------------------------------------------------------
-- 4. 距離の三点測位対策（get_profile_distances v3）
--    ・返す値は表示と同じ帯域（<5→3 / 〜30は5km刻み / 〜100は10km刻み / 超は110）
--    ・ペア固定ジッター（±1.5km・ペアIDから決定的に算出＝再測定で消せない）
--    ・対象は active・異性・非ブロックのみ
-- ------------------------------------------------------------
create or replace function public.get_profile_distances(p_user_ids uuid[])
returns table(user_id uuid, distance_km integer)
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  my_lat double precision;
  my_lng double precision;
  my_gender text;
begin
  select l.loc_lat, l.loc_lng into my_lat, my_lng
  from profile_locations l where l.user_id = uid;
  if my_lat is null or my_lng is null then
    return; -- 位置未許可: 距離機能なし
  end if;
  select p.gender into my_gender from profiles p where p.id = uid;

  return query
    select
      l.user_id,
      -- ペア固定ジッター: hashtextextended から [-1.5, +1.5] km を決定的に生成
      (with d as (
        select greatest(0.0,
          public._distance_km(my_lat, my_lng, l.loc_lat, l.loc_lng)
          + (((hashtextextended(least(uid, l.user_id)::text || greatest(uid, l.user_id)::text, 42) % 3001) + 3001) % 3001)::float / 1000.0 - 1.5
        ) as km
      )
      select case
        when d.km < 5 then 3
        when d.km <= 30 then greatest(5, (round(d.km / 5) * 5))::int
        when d.km <= 100 then (round(d.km / 10) * 10)::int
        else 110
      end from d)::int
    from profile_locations l
    join profiles p on p.id = l.user_id
    where l.user_id = any(p_user_ids)
      and l.user_id <> uid
      and p.status = 'active'
      and p.gender is distinct from my_gender          -- 異性のみ
      and not public.is_blocked_between(uid, l.user_id); -- ブロック除外
end;
$$;

-- ------------------------------------------------------------
-- 5. set_my_location の更新制限（30分間隔・1日8回）
-- ------------------------------------------------------------
alter table profile_locations add column daily_count int not null default 1;
alter table profile_locations add column daily_date date not null default (now() at time zone 'Asia/Tokyo')::date;

create or replace function public.set_my_location(p_lat double precision, p_lng double precision)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur profile_locations;
  today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;

  select * into cur from profile_locations where user_id = uid;

  if cur.user_id is not null then
    -- 30分間隔制限（三点測位対策: 短時間の位置偽装を阻む）
    if cur.updated_at > now() - interval '30 minutes' then
      raise exception 'too_frequent';
    end if;
    -- 1日8回まで
    if cur.daily_date = today and cur.daily_count >= 8 then
      raise exception 'daily_limit';
    end if;
  end if;

  insert into profile_locations (user_id, loc_lat, loc_lng, daily_count, daily_date)
  values (
    uid,
    round(p_lat::numeric, 2)::double precision,
    round(p_lng::numeric, 2)::double precision,
    1,
    today
  )
  on conflict (user_id) do update set
    loc_lat = excluded.loc_lat,
    loc_lng = excluded.loc_lng,
    updated_at = now(),
    daily_count = case when profile_locations.daily_date = today
                       then profile_locations.daily_count + 1 else 1 end,
    daily_date = today;
end;
$$;

-- ------------------------------------------------------------
-- 6. review_verification: reviewed_by の記録（管理者ID導入前は null 可）
-- ------------------------------------------------------------
create or replace function public.review_verification(
  verification_id uuid,
  approve boolean,
  reason text default null,
  p_reviewer uuid default null
)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v verifications;
begin
  select * into v from verifications where id = verification_id;
  if v.id is null then
    raise exception 'verification_not_found';
  end if;

  update verifications
  set status = case when approve then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = p_reviewer,
      reject_reason = case when approve then null else reason end
  where id = verification_id;

  if approve then
    update profiles set
      is_verified = case when v.kind = 'identity' then true else is_verified end,
      income_verified = case when v.kind = 'income' then true else income_verified end,
      single_cert_verified = case when v.kind = 'single_cert' then true else single_cert_verified end
    where id = v.user_id;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 7. 写真の事前審査キュー（人力+AIハイブリッド・表示切替はP2）
--    status: pending(未審査・本人のみ表示) / approved / rejected
--    ai_verdict: AI画像解析の判定（キー未設定時は null のまま=人力のみ）
-- ------------------------------------------------------------
create table photo_reviews (
  path text primary key,             -- photosバケット内のパス（user_id/uuid.jpg）
  user_id uuid references profiles(id) not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  ai_verdict text,                   -- 'ok' | 'ng' | 'unsure'（AI差し込み口・M6.5-P3）
  ai_detail text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table photo_reviews enable row level security;
-- 本人は自分の審査状況のみ閲覧可（アップロード登録はRPC経由）
create policy "本人のみ自分の審査状況を閲覧可" on photo_reviews
  for select to authenticated
  using (user_id = auth.uid());
grant select on public.photo_reviews to authenticated;
grant all on public.photo_reviews to service_role;

-- アップロード時に審査キューへ登録するRPC（本人のパスのみ）
create or replace function public.register_photo_for_review(p_path text)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  -- パスは必ず「自分のユーザーID/」で始まること（他人領域への登録を禁止）
  if position(auth.uid()::text || '/' in p_path) <> 1 then
    raise exception 'invalid_path';
  end if;
  insert into photo_reviews (path, user_id) values (p_path, auth.uid())
  on conflict (path) do nothing;
end;
$$;
revoke execute on function public.register_photo_for_review(text) from public, anon;
grant execute on function public.register_photo_for_review(text) to authenticated, service_role;

-- 承認済み写真パスの集合を返す（表示側がフィルタに使う。本人の写真は審査状況に関わらず本人に見える）
create or replace function public.get_approved_photo_paths(p_paths text[])
returns table(path text)
language sql stable security definer set search_path = public as $$
  select pr.path from photo_reviews pr
  where pr.path = any(p_paths)
    and (pr.status = 'approved' or pr.user_id = auth.uid());
$$;
revoke execute on function public.get_approved_photo_paths(text[]) from public, anon;
grant execute on function public.get_approved_photo_paths(text[]) to authenticated, service_role;
