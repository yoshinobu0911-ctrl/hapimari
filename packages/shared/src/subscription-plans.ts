/**
 * 有料プランの正式定義（M7.1・docs/design/M7_1_payment_design.md §3）
 *
 * 金額は 2026-07-30 オーナー決定。すべて**税込の総額表示**。
 * Stripe 側にも同額の Price を JPY で登録し、Price ID は Edge Function の
 * 環境変数（STRIPE_PRICE_MALE_1M / _3M / _6M）で受け取る。
 * 金額をここに書くのは「表示のため」であり、実際の請求額は常に Stripe の Price が正。
 *
 * ※ 旧 `SUBSCRIPTION_PLANS`（payment-provider.ts）はモック課金用の定義。
 *    M7.2 の画面改修でこちらへ完全移行し、旧定義は削除する。
 */

export const SUBSCRIPTION_PLAN_IDS = ['male_1m', 'male_3m', 'male_6m'] as const;

export type SubscriptionPlanId = (typeof SUBSCRIPTION_PLAN_IDS)[number];

export interface PaidPlan {
  id: SubscriptionPlanId;
  name: string;
  /** 請求1回あたりの金額（円・税込） */
  amount: number;
  /** 請求間隔（月） */
  months: number;
  /** 実質月額（円・税込・端数切り上げ） */
  monthlyEquivalent: number;
  /** 画面上の推し（表の推奨は3ヶ月） */
  recommended: boolean;
}

export const PAID_PLANS: readonly PaidPlan[] = [
  {
    id: 'male_1m',
    name: '1ヶ月プラン',
    amount: 4980,
    months: 1,
    monthlyEquivalent: 4980,
    recommended: false,
  },
  {
    id: 'male_3m',
    name: '3ヶ月プラン',
    amount: 11940,
    months: 3,
    monthlyEquivalent: 3980,
    recommended: true,
  },
  {
    id: 'male_6m',
    name: '6ヶ月プラン',
    amount: 16680,
    months: 6,
    monthlyEquivalent: 2780,
    recommended: false,
  },
];

export function isSubscriptionPlanId(value: unknown): value is SubscriptionPlanId {
  return typeof value === 'string' && (SUBSCRIPTION_PLAN_IDS as readonly string[]).includes(value);
}

/** Stripe の subscription.status のうち「利用できる」と見なすもの（DBの判定と一致させる） */
export const ENTITLED_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const;
