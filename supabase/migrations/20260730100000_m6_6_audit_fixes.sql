-- ============================================================
-- M6.6 全面監査（2026-07-30・8次元＋敵対的検証）で確定した4件の修正
--
--   #1 P1: 凍結・退会ユーザーがデートRPC経由で messages RLS を貫通し送信できる
--   #2 P1: 凍結・退会ユーザーが会員列挙と測距を継続できる（呼び出し元のstatus未検証）
--   #3 P1: ペア固定ジッターは定数のため三点測位で自宅圏(約1km)が復元可能
--   #4 P2: ブロック・退会後も写真の署名URLを発行できる
--
-- 設計方針: 「呼び出し元が active か」を単一のヘルパに集約し、全ての read/write 経路から
--           参照する（監査チェックリスト §D-2 の単一認可）。
-- ============================================================

-- ------------------------------------------------------------
-- 共通ヘルパ: 呼び出し元の資格
--   is_caller_active     … 凍結(suspended)・退会(withdrawn)でないこと
--   can_caller_message   … messages INSERTポリシーと同一の資格（R2本人確認・R9課金）
--     ※ security definer 関数から messages に INSERT する経路は RLS を迂回するため、
--        同じ条件をここで明示的に再現して迂回を塞ぐ。
-- ------------------------------------------------------------
create or replace function public.is_caller_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and status = 'active'
  );
$$;
revoke execute on function public.is_caller_active() from public, anon;
grant execute on function public.is_caller_active() to authenticated, service_role;

create or replace function public.can_caller_message()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and status = 'active'
      and is_verified = true
      and (gender = 'female' or subscription_active = true)
  );
$$;
revoke execute on function public.can_caller_message() from public, anon;
grant execute on function public.can_caller_message() to authenticated, service_role;

-- ------------------------------------------------------------
-- #1: デート系RPCの共通ガードに「呼び出し元の資格」を追加
--     _date_get_match は set_date_intent / propose_date_slot / respond_date_slot /
--     cancel_date / submit_date_feedback の全てが最初に通る単一の入口。
--     ここで塞げば、自動メッセージ生成経路の RLS 迂回がすべて閉じる。
-- ------------------------------------------------------------
create or replace function public._date_get_match(p_match_id uuid)
returns matches
language plpgsql stable security definer set search_path = public as $$
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
  if public.is_blocked_between(m.user_a, m.user_b) then
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
end $$;

-- #1 の本丸: メッセージ挿入そのものに資格チェックを課す
--   security definer 関数（デート系RPC等）からの INSERT は RLS を迂回するため、
--   トリガで同じ条件を強制する。これにより現在も将来も「definer経由の抜け道」が塞がる。
--   ・利用者自身の操作に伴う挿入（sender = auth.uid()）のみを検査対象とする
--   ・service_role / seed など auth.uid() が無い経路は対象外（管理操作を壊さない）
create or replace function public._enforce_message_entitlement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.sender <> auth.uid() then
      raise exception 'sender_mismatch';
    end if;
    if not public.can_caller_message() then
      raise exception 'not_entitled';
    end if;
  end if;
  return new;
end $$;
create trigger trg_enforce_message_entitlement before insert on messages
  for each row execute function public._enforce_message_entitlement();

-- 通話記録も呼び出し元の資格を要求（凍結ユーザーの通話痕跡を作らせない）
drop policy if exists "当事者かつ非ブロックのみ記録作成可" on calls;
drop policy if exists "当事者・active・非ブロックのみ記録作成可" on calls;
create policy "当事者・active・非ブロックのみ記録作成可" on calls
  for insert to authenticated
  with check (
    public.is_match_participant(match_id)
    and not public.is_match_blocked(match_id)
    and public.is_caller_active()
  );

-- ------------------------------------------------------------
-- #3: 距離の三点測位対策をやり直す
--
--   旧: 正確な距離 + ペア固定ジッター(±1.5km) → 帯域化
--       ジッターはペアごとの「単一定数」なので、攻撃者が自位置を変えて
--       複数回測ると未知数1個として代数的に解け、交点から自宅圏が復元できた。
--
--   新: 相手の座標を約5km格子のセル中心へ量子化してから距離を測る。
--       攻撃者がどこから何回測っても「セル中心までの距離」しか得られないため、
--       多点観測の交点は点に収束せず、セル（約5km四方）に留まる。
--       ＝ 三点測位で得られる情報がセルの識別までに原理的に制限される。
-- ------------------------------------------------------------
create or replace function public._snap_lat(p_lat double precision)
returns double precision
language sql immutable as $$
  -- 0.045度 ≒ 5.0km（緯度は経度に依らず一定）
  select round((p_lat / 0.045)::numeric, 0)::double precision * 0.045;
$$;

create or replace function public._snap_lng(p_lng double precision)
returns double precision
language sql immutable as $$
  -- 0.055度 ≒ 5.0km（日本の緯度帯 35N 付近での近似）
  select round((p_lng / 0.055)::numeric, 0)::double precision * 0.055;
$$;

create or replace function public.get_profile_distances(p_user_ids uuid[])
returns table(user_id uuid, distance_km integer)
language plpgsql stable security definer set search_path = public as $$
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
      and not public.is_blocked_between(uid, l.user_id);
end;
$$;

-- ------------------------------------------------------------
-- #4: 写真の可視判定に「所有者が active」「非ブロック」を追加
--     旧 is_photo_approved は承認済みなら誰にでも true を返していたため、
--     パスを保持していればブロック後・退会後も署名URLを発行できた。
-- ------------------------------------------------------------
create or replace function public.is_photo_visible_to(p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from photo_reviews pr
    join profiles owner on owner.id = pr.user_id
    where pr.path = p_path
      and pr.status = 'approved'
      and owner.status = 'active'
      and not public.is_blocked_between(auth.uid(), pr.user_id)
  );
$$;
revoke execute on function public.is_photo_visible_to(text) from public, anon;
grant execute on function public.is_photo_visible_to(text) to authenticated, service_role;

drop policy if exists "photos_承認済みまたは本人のみ読み取り可" on storage.objects;
drop policy if exists "photos_本人または可視な承認済みのみ読み取り" on storage.objects;
create policy "photos_本人または可視な承認済みのみ読み取り可" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_photo_visible_to(name)
    )
  );

-- ------------------------------------------------------------
-- #2: 公開プロフィールのビューにも「呼び出し元が active」を要求
--     （自分の行は常に見える＝凍結・退会後も自分の状態は確認できる）
--     写真の絞り込みも is_photo_visible_to に統一。
-- ------------------------------------------------------------
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
       where public.is_photo_visible_to(u)),
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
  or (
    public.is_caller_active()
    and status = 'active'
    and not public.is_blocked_between(auth.uid(), id)
  );
