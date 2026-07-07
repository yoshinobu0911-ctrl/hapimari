-- ============================================================
-- M6修正: 位置情報を専用テーブルへ分離
--
-- 理由（E2Eで発覚）: 座標を profiles 列に置いたままカラム単位で SELECT を
-- 遮断すると、アプリ全体の select('*')（PostgRESTの select=*）が 42501 で
-- 全滅する。座標は profile_locations に分離し、profiles は従来どおり
-- テーブル単位の SELECT に戻す。
--
-- プライバシーはむしろ強化される:
--   ・profile_locations は authenticated への GRANT を一切付けない（読み書き不可）
--   ・書き込みは set_my_location RPC（security definer・丸め込み）のみ
--   ・読み出しは get_profile_distances RPC（丸めた距離のみ返す）のみ
-- ============================================================

-- 1. 専用テーブル（既定拒否のまま＝ポリシーもGRANTも付けない）
create table profile_locations (
  user_id uuid primary key references profiles(id),
  loc_lat double precision not null,
  loc_lng double precision not null,
  updated_at timestamptz not null default now()
);
alter table profile_locations enable row level security;
grant all on public.profile_locations to service_role;

-- 2. 既存データの移行
insert into profile_locations (user_id, loc_lat, loc_lng)
select id, loc_lat, loc_lng from profiles
where loc_lat is not null and loc_lng is not null;

-- 3. profiles から座標列を撤去し、SELECT をテーブル単位に戻す
drop trigger trg_profiles_round_loc on profiles;
drop function public.round_profile_location();
alter table profiles drop column loc_lat;
alter table profiles drop column loc_lng;
alter table profiles drop column loc_updated_at;
grant select on public.profiles to authenticated;

-- 4. 位置の登録・更新はRPCのみ（丸めもここで強制・プライバシー原則1）
create or replace function public.set_my_location(p_lat double precision, p_lng double precision)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  insert into profile_locations (user_id, loc_lat, loc_lng)
  values (
    auth.uid(),
    round(p_lat::numeric, 2)::double precision,
    round(p_lng::numeric, 2)::double precision
  )
  on conflict (user_id) do update set
    loc_lat = excluded.loc_lat,
    loc_lng = excluded.loc_lng,
    updated_at = now();
end;
$$;
revoke execute on function public.set_my_location(double precision, double precision) from public, anon;
grant execute on function public.set_my_location(double precision, double precision) to authenticated, service_role;

-- 5. 距離RPCを profile_locations 参照に差し替え
create or replace function public.get_profile_distances(p_user_ids uuid[])
returns table(user_id uuid, distance_km integer)
language plpgsql stable security definer set search_path = public as $$
declare
  my_lat double precision;
  my_lng double precision;
begin
  select l.loc_lat, l.loc_lng into my_lat, my_lng
  from profile_locations l where l.user_id = auth.uid();
  if my_lat is null or my_lng is null then
    return; -- 位置未許可: 距離機能なし（オーナー決定）
  end if;
  return query
    select l.user_id, greatest(0, round(public._distance_km(my_lat, my_lng, l.loc_lat, l.loc_lng)))::int
    from profile_locations l
    where l.user_id = any(p_user_ids);
end;
$$;
