-- I15（PR#1 統合指摘表）: 受信いいねを「表示日の割当（R4 繰越）→ 新しい順にページ化」して返す RPC。
-- 旧実装（likes.tsx で全件取得→画面で割当）は max_rows=1000 で無言に打ち切られ、
-- 受信1000件超で新着が欠け、繰越件数も過小になっていた。
-- 設計: docs/design/2026-09-26_I15_設計提案.md
--
-- 割当アルゴリズムは packages/shared/src/like_visibility.ts の assignVisibleDates と同じ:
--   created_at 昇順（NULL は先頭・同時刻は id 昇順）に走査し、
--   display_date = max(created_at の JST 日付, 直前の display_date)。その日の件数が上限なら翌日へ繰越。
--   上限は受信者が女性なら 100（FEMALE_DAILY_LIKE_LIMIT と同値。SQL テストで固定）、それ以外は無制限。
-- 対象は送り主が profiles_public に見える人だけ（現行画面と同じく、絞り込んでから割当てる）。
-- security invoker: likes の既存 RLS（自分が送った/もらった行のみ）に従い、加えて to_user = auth.uid() に限定。
create or replace function public.get_received_likes_page(
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns table (
  like_id uuid,
  from_user uuid,
  message text,
  created_at timestamptz,
  display_date date,
  carried_over_count integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_daily_limit integer;          -- null = 無制限
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_cur date := null;
  v_cnt integer := 0;
  v_cand date;
  v_page integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_carried integer := 0;
  v_ids uuid[] := '{}';
  v_dates date[] := '{}';
  r record;
begin
  if v_uid is null then
    return;
  end if;

  select case when p.gender = 'female' then 100 else null end
    into v_daily_limit
  from profiles p where p.id = v_uid;

  for r in
    select l.id, l.created_at
    from likes l
    where l.to_user = v_uid
      and l.from_user in (select pp.id from profiles_public pp)
    order by l.created_at asc nulls first, l.id asc
  loop
    v_cand := case when r.created_at is null then v_today
                   else (r.created_at at time zone 'Asia/Tokyo')::date end;
    if v_cur is not null and v_cand < v_cur then
      v_cand := v_cur;
    end if;
    if v_cur is distinct from v_cand then
      v_cur := v_cand;
      v_cnt := 0;
    end if;
    if v_daily_limit is not null and v_cnt >= v_daily_limit then
      v_cur := v_cur + 1;
      v_cnt := 0;
    end if;
    v_cnt := v_cnt + 1;
    if v_cur <= v_today then
      v_ids := v_ids || r.id;
      v_dates := v_dates || v_cur;
    else
      v_carried := v_carried + 1;
    end if;
  end loop;

  return query
    select l.id, l.from_user, l.message, l.created_at, a.d, v_carried
    from unnest(v_ids, v_dates) as a(id, d)
    join likes l on l.id = a.id
    where p_before_id is null
       or (coalesce(l.created_at, '-infinity'::timestamptz), l.id)
          < (coalesce(p_before_created_at, '-infinity'::timestamptz), p_before_id)
    order by coalesce(l.created_at, '-infinity'::timestamptz) desc, l.id desc
    limit v_page;
end;
$$;

comment on function public.get_received_likes_page(timestamptz, uuid, integer) is
  'I15: 受信いいねを R4 の表示日割当（女性受信者は1日100件・超過は翌日以降へ繰越）の後で新しい順にページ化して返す。カーソルは直前ページ最終行の (created_at, like_id)。carried_over_count は全体の繰越件数。INVOKER で likes の RLS に従い to_user=auth.uid() に限定';

-- 新規関数には PUBLIC の EXECUTE が既定で付くため、必ず明示的に revoke する
revoke execute on function public.get_received_likes_page(timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_received_likes_page(timestamptz, uuid, integer) to authenticated, service_role;
