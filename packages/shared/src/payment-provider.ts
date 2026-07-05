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
