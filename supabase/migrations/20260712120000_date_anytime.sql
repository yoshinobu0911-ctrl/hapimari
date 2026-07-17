-- ============================================================
-- 2026-07-12 オーナー指示: デート打診の「20通以上」条件を撤廃
--   マッチ成立直後から「デートの相談」を利用できるようにする
--   （set_date_intent から message_count チェックを削除）
-- ============================================================

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

  -- 2026-07-12: 「message_count >= 20」の条件は撤廃（マッチ直後から利用可）

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
    update date_proposals set status = 'collecting' where id = d.id;
  end if;

  return public.get_date_status(p_match_id);
end;
$$;
