-- ============================================================
-- M4: デート移行支援（docs/design/M4_design.md・オーナー承認済み）
--   3.1 date_proposals の直接アクセス遮断（R6: intent を相手に見せない）
--   3.2 アクティブ提案は1マッチ1件（部分ユニーク・done/cancelled後は再打診可）
--   3.3 RPC群（security definer・当事者検証・R5/R6/R7をサーバ側で担保）
--   通知は「自動メッセージ」方式（承認済み判断#1）: 成立/確定/キャンセル時に
--   messages へ挿入し、既存の messages Realtime で両者に届く
-- ============================================================

-- ------------------------------------------------------------
-- 3.1 直接DMLの遮断（既存の当事者ポリシーは intent が相手に見えて R6違反）
-- ------------------------------------------------------------
drop policy "当事者のみ閲覧可" on date_proposals;
drop policy "当事者のみ作成可" on date_proposals;
drop policy "当事者のみ更新可" on date_proposals;
revoke select, insert, update on table public.date_proposals from authenticated;
-- service_role（管理画面・運営）は既存GRANTのまま全権

-- ------------------------------------------------------------
-- 3.2 アクティブ提案は1マッチ1件
-- ------------------------------------------------------------
create unique index uniq_active_date_proposal
  on date_proposals (match_id) where status not in ('done','cancelled');

-- ------------------------------------------------------------
-- 内部ヘルパ: 当事者検証つきでマッチを取得（各RPCの先頭で使用）
-- ------------------------------------------------------------
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
  return m;
end $$;
revoke execute on function public._date_get_match(uuid) from public, anon;

-- ------------------------------------------------------------
-- get_date_status: 自分視点のマスク済み状態（R6の核）
--   ・相手の intent は両者一致（both_agreed）以外の形で決して返さない
--   ・status='collecting' かつ自分が未回答の間は「行の存在」も隠す
--     （相手が意思表示した事実そのものが漏れるため）
-- ------------------------------------------------------------
create or replace function public.get_date_status(p_match_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
  is_a boolean;
  my_intent boolean;
  my_fb text;
  pending jsonb := null;
  i_am_proposer boolean := false;
  can_fb boolean := false;
  none jsonb;
begin
  m := public._date_get_match(p_match_id);
  is_a := (m.user_a = uid);

  none := jsonb_build_object(
    'exists', false, 'status', null, 'my_intent', null, 'both_agreed', false,
    'pending_slot', null, 'i_am_proposer', false, 'confirmed_slot', null,
    'area_suggestion', null, 'my_feedback', null, 'can_feedback', false,
    'message_count', m.message_count);

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null then
    return none;
  end if;

  my_intent := case when is_a then d.intent_a else d.intent_b end;

  -- R6: 相手だけが動いた collecting 状態は「何もない」と同じ見え方にする
  if d.status = 'collecting' and my_intent is null then
    return none;
  end if;

  my_fb := case when is_a then d.feedback_a else d.feedback_b end;

  if d.status = 'scheduling'
     and jsonb_array_length(coalesce(d.proposed_slots, '[]'::jsonb)) > 0 then
    pending := d.proposed_slots -> (jsonb_array_length(d.proposed_slots) - 1);
    i_am_proposer := (pending ->> 'proposed_by')::uuid = uid;
  end if;

  if d.status = 'confirmed' and d.confirmed_slot is not null then
    can_fb := ((d.confirmed_slot ->> 'date')::date < (now() at time zone 'Asia/Tokyo')::date)
              and my_fb is null;
  end if;

  return jsonb_build_object(
    'exists', true,
    'status', d.status,
    'my_intent', my_intent,
    'both_agreed', coalesce(d.intent_a, false) and coalesce(d.intent_b, false),
    'pending_slot', case when d.status = 'scheduling' then pending else null end,
    'i_am_proposer', i_am_proposer,
    'confirmed_slot', case when d.status = 'confirmed' then d.confirmed_slot else null end,
    'area_suggestion', d.area_suggestion,
    'my_feedback', my_fb,
    'can_feedback', can_fb,
    'message_count', m.message_count);
end $$;
revoke execute on function public.get_date_status(uuid) from public, anon;
grant execute on function public.get_date_status(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- set_date_intent: 「会ってみたい」（R5: 20通以上で解放）
--   両者一致で status='matched' + 自動メッセージ（承認済み判断#1）
--   「今はまだ」= false 保存・相手に完全秘匿（承認済み判断#2）
--   matched 中に false へ変更すると collecting に戻る（静かに取り下げ・通知なし）
-- ------------------------------------------------------------
create or replace function public.set_date_intent(p_match_id uuid, p_intent boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
  is_a boolean;
  both_now boolean;
begin
  m := public._date_get_match(p_match_id);
  is_a := (m.user_a = uid);

  if m.message_count < 20 then
    raise exception 'not_enough_messages';
  end if;

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null then
    insert into date_proposals (match_id, intent_a, intent_b)
    values (p_match_id,
            case when is_a then p_intent else null end,
            case when is_a then null else p_intent end)
    returning * into d;
  else
    if d.status not in ('collecting','matched') then
      raise exception 'invalid_status';
    end if;
    if is_a then
      update date_proposals set intent_a = p_intent where id = d.id returning * into d;
    else
      update date_proposals set intent_b = p_intent where id = d.id returning * into d;
    end if;
  end if;

  both_now := coalesce(d.intent_a, false) and coalesce(d.intent_b, false);

  if both_now and d.status = 'collecting' then
    update date_proposals set status = 'matched' where id = d.id;
    insert into messages (match_id, sender, body) values
      (p_match_id, uid, '🎉 お二人とも「会ってみたい」が一致しました。「デートの相談」から日程を選んでみましょう。');
  elsif not both_now and d.status = 'matched' then
    -- 片方が取り下げた場合は静かに collecting へ戻す（自動メッセージなし）
    update date_proposals set status = 'collecting' where id = d.id;
  end if;

  return public.get_date_status(p_match_id);
end $$;
revoke execute on function public.set_date_intent(uuid, boolean) from public, anon;
grant execute on function public.set_date_intent(uuid, boolean) to authenticated, service_role;

-- ------------------------------------------------------------
-- propose_date_slot: 日程候補から1つ選んで提案（matched/scheduling で可）
--   slot 例: {"date":"2026-07-12","time_range":"weekend_am","label":"7/12(日) 午前"}
-- ------------------------------------------------------------
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
revoke execute on function public.propose_date_slot(uuid, jsonb, text) from public, anon;
grant execute on function public.propose_date_slot(uuid, jsonb, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- respond_date_slot: 承諾（提案者以外のみ）/ 見送り（どちらでも可・matchedに戻す）
-- ------------------------------------------------------------
create or replace function public.respond_date_slot(p_match_id uuid, p_accept boolean)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
  pending jsonb;
begin
  m := public._date_get_match(p_match_id);

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null or d.status <> 'scheduling'
     or jsonb_array_length(coalesce(d.proposed_slots, '[]'::jsonb)) = 0 then
    raise exception 'invalid_status';
  end if;

  pending := d.proposed_slots -> (jsonb_array_length(d.proposed_slots) - 1);

  if p_accept then
    if (pending ->> 'proposed_by')::uuid = uid then
      raise exception 'proposer_cannot_accept';
    end if;
    update date_proposals set confirmed_slot = pending, status = 'confirmed' where id = d.id;
    insert into messages (match_id, sender, body) values
      (p_match_id, uid,
       '📅 デートの日程が決まりました: ' || (pending ->> 'label')
       || coalesce('（' || d.area_suggestion || '）', ''));
  else
    -- 提案者の取り下げ・相手の見送りのどちらも候補選びからやり直し（通知なし）
    update date_proposals set status = 'matched' where id = d.id;
  end if;

  return public.get_date_status(p_match_id);
end $$;
revoke execute on function public.respond_date_slot(uuid, boolean) from public, anon;
grant execute on function public.respond_date_slot(uuid, boolean) to authenticated, service_role;

-- ------------------------------------------------------------
-- cancel_date: 確定後の取りやめ（承認済み判断#3・自動メッセージあり）
-- ------------------------------------------------------------
create or replace function public.cancel_date(p_match_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
begin
  m := public._date_get_match(p_match_id);

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null or d.status <> 'confirmed' then
    raise exception 'invalid_status';
  end if;

  update date_proposals set status = 'cancelled' where id = d.id;
  insert into messages (match_id, sender, body) values
    (p_match_id, uid, '申し訳ありません。今回の予定は見送らせてください。');

  return public.get_date_status(p_match_id);
end $$;
revoke execute on function public.cancel_date(uuid) from public, anon;
grant execute on function public.cancel_date(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- submit_date_feedback: 翌日フィードバック（F-05）
--   相手には見せない（承認済み判断#4）。両者入力で done。
-- ------------------------------------------------------------
create or replace function public.submit_date_feedback(p_match_id uuid, p_feedback text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  m matches;
  d date_proposals;
  uid uuid := auth.uid();
  is_a boolean;
begin
  m := public._date_get_match(p_match_id);
  is_a := (m.user_a = uid);

  if p_feedback not in ('again','end') then
    raise exception 'invalid_feedback';
  end if;

  select * into d from date_proposals
  where match_id = p_match_id and status not in ('done','cancelled')
  order by created_at desc limit 1;

  if d.id is null or d.status <> 'confirmed' or d.confirmed_slot is null then
    raise exception 'invalid_status';
  end if;
  if (d.confirmed_slot ->> 'date')::date >= (now() at time zone 'Asia/Tokyo')::date then
    raise exception 'too_early'; -- デート当日までは入力不可（翌日から）
  end if;

  if is_a then
    update date_proposals set feedback_a = p_feedback where id = d.id returning * into d;
  else
    update date_proposals set feedback_b = p_feedback where id = d.id returning * into d;
  end if;

  if d.feedback_a is not null and d.feedback_b is not null then
    update date_proposals set status = 'done' where id = d.id;
  end if;

  return public.get_date_status(p_match_id);
end $$;
revoke execute on function public.submit_date_feedback(uuid, text) from public, anon;
grant execute on function public.submit_date_feedback(uuid, text) to authenticated, service_role;
