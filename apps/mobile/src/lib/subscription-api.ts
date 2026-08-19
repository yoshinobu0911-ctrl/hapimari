/**
 * 決済まわりのAPIラッパ（M7.2・docs/design/M7_2_payment_ui_design.md §1）
 *
 * - 契約状態の取得は subscriptions テーブル（RLSで本人の行のみ・列は限定GRANT）。
 *   stripe_customer_id / stripe_subscription_id には権限が無いため、
 *   `select('*')` は403になる。**必ず列を明示する。**
 * - 決済の開始・解約は Edge Function 経由。画面はDBを一切書き換えない
 *   （有料化はStripe Webhookだけが行う。M7.1の設計）。
 * - サーバーの失敗応答 { ok:false, error, message } の message は
 *   そのまま利用者に見せてよい日本語（like-api.ts と同じ取り決め）。
 */
import type { SubscriptionPlanId } from '@hapimari/shared';
import { supabase } from '@/lib/supabase';

/** 本人がSELECTできる列のうち画面が使うもの（§1.2。user_id は不要のため取らない） */
const SUBSCRIPTION_COLUMNS = 'plan, status, current_period_end, cancel_at_period_end';

export interface MySubscriptionRow {
  plan: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export async function fetchMySubscription(userId: string): Promise<MySubscriptionRow | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle<MySubscriptionRow>();
  if (error) throw error;
  return data;
}

export interface StripeFunctionFailure {
  ok: false;
  error: string;
  /** サーバーが用意した利用者向けの日本語。そのまま表示する */
  message: string;
}

export type CheckoutResult = { ok: true; url: string } | StripeFunctionFailure;

export interface CancelSuccess {
  ok: true;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

export type CancelResult = CancelSuccess | StripeFunctionFailure;

/** FunctionsHttpError のボディから { error, message } を取り出す（like-api.ts と同型） */
async function invokeStripeFunction<T extends { ok: true }>(
  name: 'stripe-checkout' | 'stripe-cancel',
  body: Record<string, unknown>,
): Promise<T | StripeFunctionFailure> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const parsed = (await ctx.json()) as Partial<StripeFunctionFailure>;
        if (typeof parsed.message === 'string') {
          return { ok: false, error: parsed.error ?? 'unknown', message: parsed.message };
        }
      } catch {
        // JSONでない応答は下のフォールバックへ
      }
    }
    return {
      ok: false,
      error: 'network',
      message: '通信に失敗しました。時間をおいてお試しください。',
    };
  }

  return data as T;
}

/** 決済ページ（Stripe Checkout）のURLを取得する。開くのは呼び出し側の責任 */
export function startCheckout(plan: SubscriptionPlanId): Promise<CheckoutResult> {
  return invokeStripeFunction<{ ok: true; url: string }>('stripe-checkout', { plan });
}

/** 期間末での解約を予約する（即時停止ではない。支払い済み期間の終わりまで使える） */
export function cancelSubscription(): Promise<CancelResult> {
  return invokeStripeFunction<CancelSuccess>('stripe-cancel', {});
}

/** 解約予約を取り消す */
export function resumeSubscription(): Promise<CancelResult> {
  return invokeStripeFunction<CancelSuccess>('stripe-cancel', { resume: true });
}
