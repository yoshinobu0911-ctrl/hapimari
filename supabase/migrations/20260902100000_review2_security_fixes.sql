-- ============================================================
-- PR #1 レビュー第2弾（satoman0703 2026-07-25 must 6件）+ 未対応4件の修正
-- 2026-09-02 オーナー指示（レビュー指摘10件の一括対応）
--
--   #1 review_verification(4引数) が PUBLIC 実行可（利用者が自分を承認できた）
--   #2 他人の承認済み写真パスを自分の photo_urls に入れるとなりすませた
--   #3 承認済みパスへ上書きすると審査を素通りできた
--   #4 set_my_location の行ロック欠落（並列で回数制限を回避できた）
--   #5 is_blocked_between の revoke 漏れ
--   #6 voice_profile_url に任意文字列を保存できた（機能未実装のまま書込可）
--   #9 propose_date_slot の p_area に長さ・NGワード検証がない
--   #10 同時相互いいねでマッチが作られない競合
--   横展開: 全関数の PUBLIC/anon 実行権限を機械的に剥奪 + 既定権限の変更
-- ============================================================

-- ------------------------------------------------------------
-- #1 review_verification の権限修復
--   M6.5-P1 で引数を3→4個に増やした際、create or replace にならず
--   「ACLなし＝PUBLIC実行可」の別関数が新規作成されていた。
--   旧3引数版は削除（PostgREST の関数解決の曖昧さも解消）。
--   M2版にあった行ロック(for update)と再審査ガードもここで復元する。
-- ------------------------------------------------------------
drop function if exists public.review_verification(uuid, boolean, text);

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
  -- 行ロック + 審査済みガード（M2版から復元。並行審査・二重審査を防ぐ）
  select * into v from verifications where id = verification_id for update;
  if v.id is null then
    raise exception 'verification_not_found';
  end if;
  if v.status <> 'pending' then
    raise exception 'already_reviewed';
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
revoke execute on function public.review_verification(uuid, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function public.review_verification(uuid, boolean, text, uuid) to service_role;

-- ------------------------------------------------------------
-- #2 写真のなりすまし防止（書き込み時と表示時の両方で塞ぐ）
--
-- (a) 書き込み側（根本対応）: photo_urls に「自分のフォルダ配下でないパス」を
--     入れられない。security definer トリガで auth.uid() 前置を強制する。
--     '://' を含む要素（seed の外部URL）は互換のため許容するが、
--     (b) の所有者検証により他人の外部URLを流用しても表示はされない。
-- ------------------------------------------------------------
create or replace function public._validate_photo_ownership()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  u text;
begin
  if auth.uid() is null then
    return new; -- service_role / seed / 匿名化ジョブは対象外
  end if;
  if new.photo_urls is null then
    return new;
  end if;
  foreach u in array new.photo_urls loop
    if position('://' in u) = 0 and position(auth.uid()::text || '/' in u) <> 1 then
      raise exception 'invalid_photo_path';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_validate_photo_ownership on profiles;
create trigger trg_validate_photo_ownership
  before insert or update of photo_urls on profiles
  for each row execute function public._validate_photo_ownership();

-- (b) 表示側: 「そのプロフィールの持ち主が、その写真の審査上の所有者か」まで検証する。
--     is_photo_visible_to(path) は所有者を見ておらず、パスを知っていれば
--     誰のプロフィールにでも載せられた（M6.6 と同型の見落とし）。
create or replace function public.is_photo_of_profile(p_path text, p_owner uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from photo_reviews pr
    join profiles owner on owner.id = pr.user_id
    where pr.path = p_path
      and pr.user_id = p_owner            -- 所有者の一致（なりすまし防止の本体）
      and pr.status = 'approved'
      and owner.status = 'active'
      and not public.is_blocked_between(auth.uid(), pr.user_id)
  );
$$;
revoke execute on function public.is_photo_of_profile(text, uuid) from public, anon;
grant execute on function public.is_photo_of_profile(text, uuid) to authenticated, service_role;

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
       where public.is_photo_of_profile(u, profiles.id)),
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

-- ------------------------------------------------------------
-- #3 承認後の上書き差し替えの禁止
--   (a) photos バケットの UPDATE ポリシーを削除（上書き経路そのものを閉じる）。
--       クライアントは常に新パス（photo_<epoch>）で upload するため機能影響なし。
--   (b) 多層防御: 同一パスが審査へ再登録されたら必ず pending に戻す
--       （従来は on conflict do nothing で approved が残った）。
-- ------------------------------------------------------------
drop policy if exists "photos_本人のみ更新可" on storage.objects;

-- 敵対的検証で発見した迂回経路: DELETE ポリシーが残っていると
-- 「承認取得 → オブジェクト削除 → 同一パスへ再アップロード」で
-- photo_reviews の approved を保ったまま画像を差し替えられる。
-- クライアントに写真削除機能は無く（差し替えは常に新パス）、退会時の削除は
-- service_role（retention ジョブ）が行うため、利用者の DELETE も閉じる。
drop policy if exists "photos_本人のみ削除可" on storage.objects;

create or replace function public.register_photo_for_review(p_path text)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  if position(auth.uid()::text || '/' in p_path) <> 1 then
    raise exception 'invalid_path';
  end if;
  insert into photo_reviews (path, user_id) values (p_path, auth.uid())
  on conflict (path) do update set
    status = 'pending',
    reviewed_at = null,
    ai_verdict = null,
    ai_detail = null;
end;
$$;

-- ------------------------------------------------------------
-- #4 set_my_location に行ロックを追加
--   select だけでは同時リクエストが両方とも「30分経過済み」を観測して通過できた。
--   for update により2本目は1本目のコミットを待ち、更新後の updated_at を見る。
-- ------------------------------------------------------------
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

  -- 行ロック（並列リクエストによる回数制限の回避を防ぐ）
  select * into cur from profile_locations where user_id = uid for update;

  if cur.user_id is not null then
    if cur.updated_at > now() - interval '30 minutes' then
      raise exception 'too_frequent';
    end if;
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
-- #6 voice_profile_url の書き込み遮断
--   音声プロフィール機能は未実装（アプリに読み書きコードが存在しない）のに、
--   列単位GRANTで任意の文字列URLを保存できた。機能を実装するまで書き込み不可にする。
--   実装時は写真と同様「バケット内パス + 審査」方式にすること。
-- ------------------------------------------------------------
revoke insert (voice_profile_url), update (voice_profile_url)
  on public.profiles from authenticated;

-- ------------------------------------------------------------
-- #9 propose_date_slot: p_area / label の長さ・NGワード検証
--   いいねの一言（Edge Function）と同じ辞書で検査する。エリア名・ラベルは
--   相手に自動メッセージとして届くため、送信自体を拒否する。
-- ------------------------------------------------------------
create or replace function public._contains_fraud_word(p_text text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from fraud_words w
    where lower(translate(coalesce(p_text, ''),
      'ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９',
      'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz0123456789'))
      like '%' || w.word || '%'
  );
$$;
revoke execute on function public._contains_fraud_word(text) from public, anon, authenticated;

create or replace function public.propose_date_slot(p_match_id uuid, p_slot jsonb, p_area text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
  slot jsonb;
begin
  m := public._date_get_match(p_match_id);

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null or d.status not in ('matched','scheduling') then
    raise exception 'invalid_status';
  end if;
  if not (coalesce(d.intent_a, false) and coalesce(d.intent_b, false)) then
    raise exception 'not_agreed';
  end if;

  -- 入力検証: 日付は明日以降・時間帯は4種のみ・ラベルは40文字以内
  if (p_slot ->> 'date') is null
     or (p_slot ->> 'date')::date <= (now() at time zone 'Asia/Tokyo')::date then
    raise exception 'invalid_slot_date';
  end if;
  if (p_slot ->> 'time_range') not in ('weekday_lunch','weekend_am','weekend_pm','weekday_night') then
    raise exception 'invalid_slot_time';
  end if;
  if (p_slot ->> 'label') is null or char_length(p_slot ->> 'label') > 40 then
    raise exception 'invalid_slot_label';
  end if;
  -- エリア名: 40文字以内 + NGワード（いいねの一言と同じ扱い。相手に届く文字列）
  if char_length(coalesce(p_area, '')) > 40 then
    raise exception 'invalid_area';
  end if;
  if public._contains_fraud_word(p_area) or public._contains_fraud_word(p_slot ->> 'label') then
    raise exception 'fraud_words_in_proposal';
  end if;

  slot := jsonb_build_object(
    'date', p_slot ->> 'date',
    'time_range', p_slot ->> 'time_range',
    'label', p_slot ->> 'label',
    'proposed_by', uid);

  update date_proposals set
    proposed_slots = coalesce(proposed_slots, '[]'::jsonb) || jsonb_build_array(slot),
    status = 'scheduling',
    area_suggestion = coalesce(nullif(trim(coalesce(p_area, '')), ''), area_suggestion)
  where id = d.id;

  return public.get_date_status(p_match_id);
end $$;

-- ------------------------------------------------------------
-- #10 相互いいねの同時挿入でマッチが欠落する競合
--   ペア単位のアドバイザリロックで直列化する。後発トランザクションは
--   先発のコミットを待ってから exists を評価するため、必ず相手の行が見える。
-- ------------------------------------------------------------
create or replace function public.create_match_on_mutual_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ペア固定のロックキー（least/greatest で両方向とも同じキーになる）
  perform pg_advisory_xact_lock(hashtextextended(
    least(new.from_user, new.to_user)::text || '/' || greatest(new.from_user, new.to_user)::text, 0));
  if exists (select 1 from likes where from_user = new.to_user and to_user = new.from_user) then
    insert into matches (user_a, user_b)
    values (least(new.from_user, new.to_user), greatest(new.from_user, new.to_user))
    on conflict (user_a, user_b) do nothing;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 横展開（#1 / #5 と同型の総点検）:
--   全関数から PUBLIC / anon の EXECUTE を機械的に剥奪する。
--   デフォルトでは Postgres は新規関数に PUBLIC 実行権限を付けるため、
--   ACL を書き忘れた関数（is_blocked_between / is_match_participant /
--   トリガ関数群など）が anon からも実行可能になっていた。
-- ------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- 剥奪後に必要な分だけ明示付与し直す:
--   is_blocked_between   … profiles_public ビュー内で呼ばれる（ビュー内の関数は
--                          「ビューの利用者」の権限で検査されるため authenticated が必要）
--   is_match_participant … messages / calls / date系の RLS ポリシー内で呼ばれる
revoke execute on function public.is_blocked_between(uuid, uuid) from authenticated; -- 明示ACLを作る
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_match_participant(uuid) to authenticated, service_role;

-- 使われていない「承認状態の照会オラクル」を利用者から剥奪
--   （m6_6 で is_photo_visible_to に置き換え済み。任意パスの承認有無を
--     探れる必要はもう無い）
revoke execute on function public.is_photo_approved(text) from authenticated;
revoke execute on function public.get_approved_photo_paths(text[]) from authenticated;

-- 再発防止: 今後作成する関数に PUBLIC の既定実行権限を付けない
--   （以後の migration は必要なロールへ明示 grant する運用。既存の書き方と同じ）
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
