/**
 * 決済プロバイダのインターフェース（SPEC §8）
 *
 * MVPでは常に成功を返すモックを使用する。
 * 本番では RevenueCat 実装に差し替える（差し替えポイントはこのファイルのみ）。
 * 本実装は M6 で行う。ここではインターフェースとモックのみを定義する。
 */

export interface SubscriptionStatus {
  active: boolean;
  /** ISO8601。モックでは null */
  expiresAt: string | null;
}

/** プラン定義（M6設計書 A1/B5・2026-07-07 オーナー承認） */
export interface SubscriptionPlan {
  id: 'male_standard' | 'female_premium';
  name: string;
  /** 判断#4: 男性プランは正式リリースまで金額を出さない */
  priceLabel: string;
  targetGender: 'male' | 'female';
  /** false = 将来枠（UIに出さない・購入不可） */
  available: boolean;
  description: string;
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  {
    id: 'male_standard',
    name: 'スタンダードプラン',
    priceLabel: '価格は正式リリース時に決定します',
    targetGender: 'male',
    available: true,
    description: 'メッセージの送信ができるようになります。お相手探し・いいね・受信は無料のままです。',
  },
  {
    // 将来枠（B5）: まじめに活動する女性の相互スクリーニング用。RevenueCat本実装時に有効化
    id: 'female_premium',
    name: 'プレミアムプラン（女性）',
    priceLabel: '月額500円（予定）',
    targetGender: 'female',
    available: false,
    description: '真剣に活動する女性のための優先表示など（準備中）。',
  },
];

export interface PaymentProvider {
  /** 現在の課金状態を取得する */
  getSubscriptionStatus(userId: string): Promise<SubscriptionStatus>;
  /** 課金を開始する（ストア課金フローの起動） */
  purchase(userId: string): Promise<{ success: boolean; error?: string }>;
  /** 復元（機種変更時など） */
  restore(userId: string): Promise<SubscriptionStatus>;
}

/** 常に成功を返すモック実装（MVP用） */
export class MockPaymentProvider implements PaymentProvider {
  private readonly activeUsers = new Set<string>();

  async getSubscriptionStatus(userId: string): Promise<SubscriptionStatus> {
    return { active: this.activeUsers.has(userId), expiresAt: null };
  }

  async purchase(userId: string): Promise<{ success: boolean; error?: string }> {
    this.activeUsers.add(userId);
    return { success: true };
  }

  async restore(userId: string): Promise<SubscriptionStatus> {
    return this.getSubscriptionStatus(userId);
  }
}
