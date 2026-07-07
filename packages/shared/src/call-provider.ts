/**
 * 音声通話プロバイダのインターフェース（SPEC §8 / docs/design/M5_design.md §4）
 *
 * MVPは apps/mobile の RealtimeMockCallProvider（Supabase Realtime broadcast による
 * シグナリングのみ・音声なし）を使う。Agora 契約後はこのインターフェースの別実装を
 * 作って差し替える（呼び出し側のUIは無変更）。
 */

import { CALL_MAX_DURATION_SECONDS } from './constants';

export type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended';

export type CallEndReason = 'hangup' | 'declined' | 'timeout' | 'no_answer' | 'error';

export interface CallProviderEvents {
  onStateChange: (state: CallState) => void;
  onEnded: (reason: CallEndReason) => void;
}

export interface CallHandle {
  hangup: () => void;
}

export interface CallListenHandlers {
  /** 着信（invite受信）時 */
  onIncoming: () => void;
  /** 発信側の取り下げ・タイムアウト時（着信表示を消す） */
  onCancelled: () => void;
}

export interface CallListener {
  /** 監視を解除する（画面のブラー・アンマウント時） */
  stop: () => void;
  /** 着信を拒否する（発信側には declined が伝わる） */
  decline: () => void;
}

export interface CallProvider {
  /** 発信する。相手が CALL_NO_ANSWER_TIMEOUT_SECONDS 以内に応答しなければ no_answer で終了 */
  startCall(matchId: string, selfId: string, events: CallProviderEvents): Promise<CallHandle>;
  /** 着信の監視を開始する（チャット画面の表示中のみ） */
  listen(matchId: string, selfId: string, handlers: CallListenHandlers): CallListener;
  /** 着信に応答して通話に参加する */
  joinCall(matchId: string, selfId: string, events: CallProviderEvents): Promise<CallHandle>;
}

/** 発信の応答待ちタイムアウト（秒） */
export const CALL_NO_ANSWER_TIMEOUT_SECONDS = 30;

/**
 * 通話の残り秒数（15分=900秒の上限から経過分を引く）。0で自動切断する。
 * 負値は返さない。
 */
export function remainingCallSeconds(
  startedAtMs: number,
  nowMs: number,
  maxSeconds: number = CALL_MAX_DURATION_SECONDS,
): number {
  const elapsed = Math.floor((nowMs - startedAtMs) / 1000);
  return Math.max(0, maxSeconds - Math.max(0, elapsed));
}

/** 経過秒数の表示（「0:00」「14:59」形式） */
export function formatCallDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
