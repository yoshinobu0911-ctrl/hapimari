-- ============================================================
-- messages.kind 列の追加（progress.md TODO・2026-08-19 オーナー包括指示で実施）
--
-- 背景: 運営の自動メッセージ（デート意向一致・日程確定）は通常のメッセージと同じ
--       行として保存され、画面は本文の接頭辞（🎉 / 📅）で見分けていた
--       （apps/mobile/src/app/chat/[matchId].tsx の暫定ヒューリスティック）。
--       文言変更で壊れるため、正式な列に置き換える。
--
-- 安全性（利用者が kind='system' を偽装できないこと）:
--   messages の INSERT 権限は列単位 GRANT（match_id, sender, body のみ・init.sql）。
--   kind は GRANT に含めないため、利用者の INSERT では常に default 'user' になる。
--   UPDATE 権限は従来から一切ない。'system' を書けるのは security definer の
--   RPC（下記2関数）と service_role だけ。
-- ============================================================

-- 1. 列追加（利用者へは SELECT のみ与える。INSERT の列 GRANT には含めない）
alter table public.messages
  add column if not exists kind text not null default 'user'
  check (kind in ('user', 'system'));

comment on column public.messages.kind is
  '自動メッセージ判定の正。user=会員の発言 / system=運営の自動メッセージ。利用者はINSERT列GRANT外のため常にuser';

-- 2. 既存データの移行: 接頭辞で運営メッセージと判定していた行を system に
--    （接頭辞はRPCが必ず付けており、利用者の本文先頭に同じ絵文字+空白が来た場合も
--      表示上「運営風」に見えていた従来挙動と同等の基準。以後は列が正になる）
update public.messages
   set kind = 'system'
 where kind = 'user'
   and (body like '🎉 %' or body like '📅 %');

-- 3. 自動メッセージを作る2関数へ kind='system' を付与
--    （3-1 は 20260712120000 の最新版・3-2 は 20260707100000 の最新版がベース。
--      変更点は INSERT に kind を足した1行のみ）

-- 3-1. set_date_intent（デート意向の一致）
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
    insert into messages (match_id, sender, body, kind) values
      (p_match_id, uid, '🎉 お二人とも「会ってみたい」が一致しました。「デートの相談」から日程を選んでみましょう。', 'system');
  elsif not both_now and d.status = 'matched' then
    update date_proposals set status = 'collecting' where id = d.id;
  end if;

  return public.get_date_status(p_match_id);
end;
$$;

-- 3-2. respond_date_slot（日程の確定）
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
    insert into messages (match_id, sender, body, kind) values
      (p_match_id, uid,
       '📅 デートの日程が決まりました: ' || (pending ->> 'label')
       || coalesce('（' || d.area_suggestion || '）', ''),
       'system');
  else
    -- 提案者の取り下げ・相手の見送りのどちらも候補選びからやり直し（通知なし）
    update date_proposals set status = 'matched' where id = d.id;
  end if;

  return public.get_date_status(p_match_id);
end $$;

-- 権限は従来どおり（create or replace は既存のGRANTを維持するが、明示のため再宣言）
revoke execute on function public.set_date_intent(uuid, boolean) from public, anon;
grant execute on function public.set_date_intent(uuid, boolean) to authenticated, service_role;
revoke execute on function public.respond_date_slot(uuid, boolean) from public, anon;
grant execute on function public.respond_date_slot(uuid, boolean) to authenticated, service_role;
