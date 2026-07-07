/**
 * デート移行支援のRPC呼び出しラッパ（docs/design/M4_design.md §3.3）
 *
 * date_proposals への直接アクセスはDB側で遮断されており、必ずこれらのRPCを使う。
 * 各RPCは実行後の最新状態（自分視点・マスク済み）を返すので、そのままキャッシュに反映できる。
 */
import type { DateSlot } from '@hapimari/shared';
import type { Json } from '@hapimari/shared/types';
import { supabase } from '@/lib/supabase';

export interface DateStatus {
  exists: boolean;
  status: 'collecting' | 'matched' | 'scheduling' | 'confirmed' | null;
  my_intent: boolean | null;
  /** 両者の「会ってみたい」が一致したか。相手単独の意思はこの形以外で開示されない（R6） */
  both_agreed: boolean;
  pending_slot: (DateSlot & { proposed_by: string }) | null;
  i_am_proposer: boolean;
  confirmed_slot: (DateSlot & { proposed_by: string }) | null;
  area_suggestion: string | null;
  my_feedback: 'again' | 'end' | null;
  can_feedback: boolean;
  message_count: number;
}

async function callRpc(
  fn:
    | 'get_date_status'
    | 'set_date_intent'
    | 'propose_date_slot'
    | 'respond_date_slot'
    | 'cancel_date'
    | 'submit_date_feedback',
  args: Record<string, Json>,
): Promise<DateStatus> {
  // biome-ignore lint/suspicious/noExplicitAny: RPC名を動的に切り替えるため（戻り値はDateStatusに正規化）
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
  return data as DateStatus;
}

export function getDateStatus(matchId: string): Promise<DateStatus> {
  return callRpc('get_date_status', { p_match_id: matchId });
}

export function setDateIntent(matchId: string, intent: boolean): Promise<DateStatus> {
  return callRpc('set_date_intent', { p_match_id: matchId, p_intent: intent });
}

export function proposeDateSlot(
  matchId: string,
  slot: DateSlot,
  area: string | null,
): Promise<DateStatus> {
  return callRpc('propose_date_slot', {
    p_match_id: matchId,
    p_slot: slot as unknown as Json,
    p_area: area,
  });
}

export function respondDateSlot(matchId: string, accept: boolean): Promise<DateStatus> {
  return callRpc('respond_date_slot', { p_match_id: matchId, p_accept: accept });
}

export function cancelDate(matchId: string): Promise<DateStatus> {
  return callRpc('cancel_date', { p_match_id: matchId });
}

export function submitDateFeedback(
  matchId: string,
  feedback: 'again' | 'end',
): Promise<DateStatus> {
  return callRpc('submit_date_feedback', { p_match_id: matchId, p_feedback: feedback });
}
