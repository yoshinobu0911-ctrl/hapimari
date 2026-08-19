import { describe, expect, it } from 'vitest';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  PAID_PLANS,
  SUBSCRIPTION_PLAN_IDS,
} from '../src/subscription-plans';
import {
  deriveSubscriptionView,
  formatJstDate,
  type SubscriptionRowLike,
} from '../src/subscription-view';

/** 2026-08-19T00:00:00Z を「現在」として固定 */
const NOW = Date.parse('2026-08-19T00:00:00Z');
const FUTURE = '2026-11-14T00:00:00Z';
const PAST = '2026-08-01T00:00:00Z';

function row(partial: Partial<SubscriptionRowLike>): SubscriptionRowLike {
  return {
    status: 'active',
    current_period_end: FUTURE,
    cancel_at_period_end: false,
    ...partial,
  };
}

describe('deriveSubscriptionView（M7.2 §2・画面状態の導出）', () => {
  it('行なしは未契約', () => {
    expect(deriveSubscriptionView(null, NOW)).toBe('none');
    expect(deriveSubscriptionView(undefined, NOW)).toBe('none');
  });

  it('決済未完了・終了済みは未契約（incomplete / incomplete_expired / canceled）', () => {
    for (const status of ['incomplete', 'incomplete_expired', 'canceled']) {
      expect(deriveSubscriptionView(row({ status }), NOW)).toBe('none');
    }
  });

  it('想定外の status は安全側（未契約）に倒す', () => {
    expect(deriveSubscriptionView(row({ status: 'unknown_future_status' }), NOW)).toBe('none');
  });

  it('有効（active / trialing）かつ期限が未来なら契約中', () => {
    expect(deriveSubscriptionView(row({ status: 'active' }), NOW)).toBe('active');
    expect(deriveSubscriptionView(row({ status: 'trialing' }), NOW)).toBe('active');
  });

  it('解約予約が付いていれば cancel_scheduled', () => {
    expect(deriveSubscriptionView(row({ cancel_at_period_end: true }), NOW)).toBe(
      'cancel_scheduled',
    );
  });

  it('期限切れは status が active のままでも未契約（DBのゲートと同じ判定）', () => {
    expect(deriveSubscriptionView(row({ current_period_end: PAST }), NOW)).toBe('none');
    // 解約予約付きでも、期限が過ぎていれば同じく未契約
    expect(
      deriveSubscriptionView(row({ current_period_end: PAST, cancel_at_period_end: true }), NOW),
    ).toBe('none');
  });

  it('期限ちょうど（境界）は未契約。1ミリ秒でも未来なら契約中', () => {
    expect(deriveSubscriptionView(row({ current_period_end: '2026-08-19T00:00:00Z' }), NOW)).toBe(
      'none',
    );
    expect(
      deriveSubscriptionView(row({ current_period_end: '2026-08-19T00:00:00.001Z' }), NOW),
    ).toBe('active');
  });

  it('期限が無い行は未契約（is_subscription_active の not null 条件と一致）', () => {
    expect(deriveSubscriptionView(row({ current_period_end: null }), NOW)).toBe('none');
  });

  it('更新決済の失敗系は payment_trouble（past_due / unpaid / paused）', () => {
    for (const status of ['past_due', 'unpaid', 'paused']) {
      expect(deriveSubscriptionView(row({ status }), NOW)).toBe('payment_trouble');
    }
  });

  it('now は Date でも数値でも同じ結果', () => {
    expect(deriveSubscriptionView(row({}), new Date(NOW))).toBe('active');
  });
});

describe('formatJstDate（日本時間の年月日）', () => {
  it('UTC深夜はJSTでは翌日になる', () => {
    expect(formatJstDate('2026-11-13T15:00:00Z')).toBe('2026年11月14日');
    expect(formatJstDate('2026-11-13T14:59:59Z')).toBe('2026年11月13日');
  });

  it('不正値・空は空文字', () => {
    expect(formatJstDate(null)).toBe('');
    expect(formatJstDate(undefined)).toBe('');
    expect(formatJstDate('not-a-date')).toBe('');
  });
});

describe('PAID_PLANS（2026-07-30 オーナー決定の金額・M7.1 §3）', () => {
  it('3プランで、IDが定義と一致する', () => {
    expect(PAID_PLANS.map((p) => p.id).sort()).toEqual([...SUBSCRIPTION_PLAN_IDS].sort());
  });

  it('総額（税込）は 4,980 / 11,940 / 16,680 円', () => {
    const byId = new Map(PAID_PLANS.map((p) => [p.id, p]));
    expect(byId.get('male_1m')?.amount).toBe(4980);
    expect(byId.get('male_3m')?.amount).toBe(11940);
    expect(byId.get('male_6m')?.amount).toBe(16680);
  });

  it('実質月額 = 総額 ÷ 月数（端数切り上げ）の検算が合う', () => {
    for (const plan of PAID_PLANS) {
      expect(plan.monthlyEquivalent).toBe(Math.ceil(plan.amount / plan.months));
    }
  });

  it('おすすめは3ヶ月プランの1つだけ（表の推奨。裏テーマの6ヶ月誘導は表示順で行う）', () => {
    expect(PAID_PLANS.filter((p) => p.recommended).map((p) => p.id)).toEqual(['male_3m']);
  });

  it('利用可とみなす status の定義が2つ（active / trialing）で画面とDBの認識が揃う', () => {
    expect([...ENTITLED_SUBSCRIPTION_STATUSES].sort()).toEqual(['active', 'trialing']);
  });
});
