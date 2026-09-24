-- I29（PR#1 統合指摘表）: ブロック関係の照会を当事者に限定し、内部判定を非公開スキーマ private へ分離する。
-- 無関係な第三者が is_blocked_between(A,B) / is_match_blocked(任意のマッチ) で
-- 他人同士のブロック関係を調べられた穴を塞ぐ。service_role（Edge Function）の内部呼び出しは維持。
-- 設計: docs/design/2026-09-24_P2必須6件_設計提案.md I29 節
--
-- 注意: snapshot の再生成は以後 `db dump --local -s public -s storage -s private` を使う
--       （-s private を付けないと private の定義と権限が snapshot から消える）

-- (1) 非公開スキーマ（PostgREST / GraphQL に公開しない。config.toml api.schemas・本番 Exposed schemas に追加禁止）
create schema if not exists private;
comment on schema private is '内部判定専用。PostgREST/GraphQLに公開しない（config.toml api.schemas・本番 Exposed schemas に追加禁止）';
revoke all on schema private from public, anon, authenticated, service_role;   -- USAGE は所有者 postgres のみ

-- (2) 内部判定（本体は 20260706200000_m3_social.sql と同じ。表名は完全修飾）
create or replace function private.is_blocked_between(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.blocks bl
    where (bl.blocker = a and bl.blocked = b) or (bl.blocker = b and bl.blocked = a)
  );
$$;
revoke all on function private.is_blocked_between(uuid, uuid) from public, anon, authenticated, service_role;

-- (3) 公開 is_blocked_between: 当事者と service_role だけが実判定を得る（署名・引数名 a/b は維持）
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- blocks.blocker/blocked は NOT NULL。NULL を含む組は常にブロックなし。
  -- service_role や Studio でビューを読んだとき（auth.uid() が NULL）に例外にしないため、先に判定する。
  if a is null or b is null then
    return false;
  end if;
  if v_uid is not null then
    if v_uid <> a and v_uid <> b then
      return false;          -- 第三者: blocks を読まずに false（有無と無関係＝区別不能）
    end if;
  elsif coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';   -- 利用者でも service_role でもない
  end if;
  return exists (
    select 1 from public.blocks bl
    where (bl.blocker = a and bl.blocked = b) or (bl.blocker = b and bl.blocked = a)
  );
end;
$$;
revoke execute on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated, service_role;
comment on function public.is_blocked_between(uuid, uuid) is
  'I29: 当事者(auth.uid()∈{a,b})と service_role だけが実判定を得る。第三者は常に false、身元なしは forbidden(42501)。SQL 内部からは private.is_blocked_between を使う';

-- (4) 公開 is_match_blocked: 当事者と service_role のみ（署名・引数名 target_match は維持）
create or replace function public.is_match_blocked(target_match uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_a uuid; v_b uuid;
begin
  if v_uid is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select m.user_a, m.user_b into v_a, v_b from public.matches m where m.id = target_match;
  if v_a is null then
    return false;                               -- 存在しない（従来どおり false）
  end if;
  if v_uid is not null and v_uid <> v_a and v_uid <> v_b then
    return false;                               -- 非当事者: 存在しない場合と同じ false
  end if;
  return private.is_blocked_between(v_a, v_b);
end;
$$;
revoke execute on function public.is_match_blocked(uuid) from public, anon;
grant execute on function public.is_match_blocked(uuid) to authenticated, service_role;
comment on function public.is_match_blocked(uuid) is
  'I29: 当事者と service_role のみ実判定。非当事者・不存在は false、身元なしは forbidden(42501)。RLS では必ず is_match_participant と AND で使う';

-- (5) 内部呼び出しの付け替え（現行定義を写し、public.is_blocked_between → private.is_blocked_between の1行だけ変更）
-- 写真の2関数は I11（20260926110000）版の本文を写している

CREATE OR REPLACE FUNCTION public._date_get_match(p_match_id uuid)
 RETURNS matches
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m matches;
begin
  -- 凍結・退会したユーザーはデート機能を一切操作できない
  -- （※ 送信資格 can_caller_message はここでは要求しない。get_date_status も
  --    この関数を通り、チャット画面の表示に使われるため。自動メッセージ挿入の
  --    資格チェックは下記 messages のトリガで一元的に強制する）
  if not public.is_caller_active() then
    raise exception 'inactive_account';
  end if;

  select * into m from matches where id = p_match_id;
  if m.id is null or (m.user_a <> auth.uid() and m.user_b <> auth.uid()) then
    raise exception 'not_participant';
  end if;
  if private.is_blocked_between(m.user_a, m.user_b) then
    raise exception 'blocked';
  end if;

  -- 相手が凍結・退会している場合も接触経路を閉じる
  if not exists (
    select 1 from profiles p
    where p.id = case when m.user_a = auth.uid() then m.user_b else m.user_a end
      and p.status = 'active'
  ) then
    raise exception 'partner_inactive';
  end if;

  return m;
end $function$;
revoke execute on function public._date_get_match(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_profile_distances(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, distance_km integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  my_lat double precision;
  my_lng double precision;
  my_gender text;
begin
  -- #2: 凍結・退会ユーザーには測距機能を渡さない
  if not public.is_caller_active() then
    return;
  end if;

  select l.loc_lat, l.loc_lng into my_lat, my_lng
  from profile_locations l where l.user_id = uid;
  if my_lat is null or my_lng is null then
    return; -- 位置未許可: 距離機能なし
  end if;
  select p.gender into my_gender from profiles p where p.id = uid;

  return query
    select
      l.user_id,
      (with d as (
        select public._distance_km(
          my_lat, my_lng,
          public._snap_lat(l.loc_lat),   -- 相手の座標をセル中心へ量子化
          public._snap_lng(l.loc_lng)
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
      and p.gender is distinct from my_gender
      and not private.is_blocked_between(uid, l.user_id);
end;
$function$;
revoke execute on function public.get_profile_distances(uuid[]) from public, anon;
grant execute on function public.get_profile_distances(uuid[]) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_photo_visible_to(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_caller_active()   -- 追加: 閲覧者 status='active'（未作成・凍結・退会・匿名化済みは false）
     and exists (
       select 1 from photo_reviews pr
       join profiles owner on owner.id = pr.user_id
       where pr.path = p_path
         and pr.status = 'approved'
         and owner.status = 'active'
         and not private.is_blocked_between(auth.uid(), pr.user_id)
     );
$function$;
revoke execute on function public.is_photo_visible_to(text) from public, anon;
grant execute on function public.is_photo_visible_to(text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_photo_of_profile(p_path text, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_caller_active()   -- 追加
     and exists (
       select 1 from photo_reviews pr
       join profiles owner on owner.id = pr.user_id
       where pr.path = p_path
         and pr.user_id = p_owner          -- 所有者の一致（なりすまし防止の本体）
         and pr.status = 'approved'
         and owner.status = 'active'
         and not private.is_blocked_between(auth.uid(), pr.user_id)
     );
$function$;
revoke execute on function public.is_photo_of_profile(text, uuid) from public, anon;
grant execute on function public.is_photo_of_profile(text, uuid) to authenticated, service_role;
