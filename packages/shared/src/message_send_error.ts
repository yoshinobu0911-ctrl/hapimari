/**
 * メッセージ送信失敗の原因別案内（I33・docs/design/2026-09-26_I33_設計提案.md）
 *
 * messages への INSERT が失敗したときの PostgREST エラーを分類し、利用者向けの日本語を返す。
 * 送信の可否はサーバー（RLS・トリガ）が決める。ここは失敗後の案内文だけを扱う。
 */

import { MESSAGE_BODY_MAX_LENGTH } from './constants';

export type MessageSendFailure = 'not_entitled' | 'rejected' | 'too_long' | 'network' | 'unknown';

/** supabase-js（PostgrestError）の必要な部分だけ */
export interface MessageSendErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * 実測した応答（2026-09-26・ローカル REST）:
 *   送信資格なし → P0001 'not_entitled'（トリガ _enforce_message_entitlement）
 *   ブロック・当事者でない → 42501（RLS 違反）
 *   本文超過 → 23514（messages_body_check）
 *   通信断 → code が空で message に fetch 失敗の文言
 */
export function classifyMessageSendError(error: MessageSendErrorLike | null): MessageSendFailure {
  if (!error) return 'unknown';
  const code = error.code ?? '';
  const message = error.message ?? '';
  if (message.includes('not_entitled')) return 'not_entitled';
  if (code === '42501') return 'rejected';
  if (code === '23514') return 'too_long';
  if (code === '' && /fetch|network|load failed/i.test(message)) return 'network';
  return 'unknown';
}

/** not_entitled のとき、サーバーへ問い合わせ直した本人の状態 */
export interface MessageSenderState {
  isActive: boolean;
  isVerified: boolean;
  /** 男性で有料プランが有効でない（課金期限を問い合わせ直した結果） */
  needsSubscription: boolean;
}

const GENERIC = '送信できませんでした。時間をおいてお試しください。';

/** 分類と（必要なら）本人の状態から、画面にそのまま出す案内文を返す */
export function messageSendFailureText(
  kind: MessageSendFailure,
  sender?: MessageSenderState,
): string {
  switch (kind) {
    case 'not_entitled':
      if (!sender) return GENERIC;
      if (!sender.isActive) {
        return 'ただいまメッセージを送信できません。アカウントの状態をご確認ください。';
      }
      if (!sender.isVerified) {
        return '本人確認の完了後に送信できます。お手続きの完了をお待ちください。';
      }
      if (sender.needsSubscription) {
        return '有料プランの有効期限が切れているため送信できません。プランの画面からご確認ください。';
      }
      return GENERIC;
    case 'rejected':
      // ブロックと相手の退会等は区別しない（相手にブロックされたことを推測させないため）
      return 'このお相手には現在メッセージを送れません。';
    case 'too_long':
      return `メッセージは${MESSAGE_BODY_MAX_LENGTH}文字以内で入力してください。`;
    case 'network':
      return '通信できませんでした。電波の良い場所で、もう一度お試しください。';
    default:
      return GENERIC;
  }
}
