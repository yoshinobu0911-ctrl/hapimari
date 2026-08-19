/**
 * 契約状態の画面向け導出（M7.2・docs/design/M7_2_payment_ui_design.md §2）
 *
 * 「画面をどう見せるか」の判定をこの1関数に集約する。
 * DB側のゲート（is_subscription_active / can_caller_message）と食い違わないよう、
 * 「status ∈ {active, trialing} かつ current_period_end が未来」という条件を揃えている。
 * 画面はこの導出結果だけを信用し、URLクエリ（checkout=success）や
 * profiles.subscription_active（トリガ同期の派生値）では判定しない。
 */

import { ENTITLED_SUBSCRIPTION_STATUSES } from './subscription-plans';

/** 画面の表示状態 */
export type SubscriptionViewState =
  /** 未契約（期限切れ・終了済み・決済未完了を含む） */
  | 'none'
  /** 契約中 */
  | 'active'
  /** 解約予約済み（期間末で終了する） */
  | 'cancel_scheduled'
  /** 更新の決済に失敗している（past_due 等）。利用資格はすでに無い */
  | 'payment_trouble';

/** subscriptions テーブルから本人が SELECT できる列のうち、判定に使うもの */
export interface SubscriptionRowLike {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

const ENTITLED: ReadonlySet<string> = new Set(ENTITLED_SUBSCRIPTION_STATUSES);

/** 更新決済の失敗系。Stripe が請求を再試行している（or 止まっている）状態 */
const TROUBLED: ReadonlySet<string> = new Set(['past_due', 'unpaid', 'paused']);

export function deriveSubscriptionView(
  row: SubscriptionRowLike | null | undefined,
  now: number | Date,
): SubscriptionViewState {
  if (!row) return 'none';
  if (TROUBLED.has(row.status)) return 'payment_trouble';
  if (!ENTITLED.has(row.status)) return 'none';

  const nowMs = typeof now === 'number' ? now : now.getTime();
  const end = row.current_period_end ? new Date(row.current_period_end).getTime() : Number.NaN;
  // 期限切れ・期限不明は、DBの is_subscription_active() と同じく「使えない」扱い
  if (!(end > nowMs)) return 'none';

  return row.cancel_at_period_end ? 'cancel_scheduled' : 'active';
}

/**
 * ISO日時 → 日本時間の「YYYY年M月D日」。不正値・null は空文字。
 * Hermes / ブラウザ間の Intl 差異を踏まないよう、+9時間の自前変換で整形する。
 */
export function formatJstDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const jst = new Date(t + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;
}
