/**
 * 決済プロバイダのアプリ実装（M6 A1・SPEC §8 のモック方針）
 *
 * PaymentProvider インターフェース（packages/shared/src/payment-provider.ts）が
 * RevenueCat 差し替えポイント。MVPでは purchase が DB の RPC（常に成功のモック課金）を呼ぶ。
 * 本実装への切り替え時はこのファイルだけを RevenueCat 版に置き換える。
 */
import type { PaymentProvider, SubscriptionStatus } from '@hapimari/shared';
import { supabase } from '@/lib/supabase';

async function readStatus(userId: string): Promise<SubscriptionStatus> {
  const { data } = await supabase
    .from('profiles')
    .select('subscription_active')
    .eq('id', userId)
    .maybeSingle();
  return { active: data?.subscription_active === true, expiresAt: null };
}

export const paymentProvider: PaymentProvider = {
  getSubscriptionStatus: readStatus,

  async purchase(_userId: string) {
    const { error } = await supabase.rpc('purchase_subscription', { p_plan: 'male_standard' });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  },

  restore: readStatus,
};
