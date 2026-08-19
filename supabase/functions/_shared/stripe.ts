/**
 * Stripe決済の共通処理（M7.1・docs/design/M7_1_payment_design.md）
 *
 * この配下のコードは Supabase Edge Runtime（Deno）で動くサーバー側コードであり、
 * シークレットキーを扱う。**アプリ（apps/mobile）から import してはならない。**
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@22.4.0';
import {
  isSubscriptionPlanId,
  type SubscriptionPlanId,
} from '../../../packages/shared/src/subscription-plans.ts';

export type { SubscriptionPlanId };
export { isSubscriptionPlanId, Stripe };

/** 使用する Stripe API バージョン（固定して、Stripe側の仕様変更で壊れないようにする） */
export const STRIPE_API_VERSION = '2026-07-29.dahlia';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** 想定内のエラー（利用者に見せる日本語メッセージつき） */
export function fail(status: number, error: string, message: string): Response {
  return json(status, { ok: false, error, message });
}

/**
 * 予期しないエラーの共通レスポンス。
 * ※ Response は本文を一度しか読めないため、定数ではなく毎回生成する。
 */
export function internalError(): Response {
  return fail(500, 'internal', 'エラーが発生しました。時間をおいてお試しください。');
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    // 値そのものは絶対にログへ出さない（名前だけ）
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

/**
 * Stripe クライアント。
 * Deno では Node の http クライアントが使えないため fetch 版を明示する。
 */
export function stripeClient(): Stripe {
  return new Stripe(requiredEnv('STRIPE_SECRET_KEY'), {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** service_role クライアント（RLSをバイパスする。呼び出し元の検証は各関数の責任） */
export function adminClient(): SupabaseClient {
  return createClient(
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: Edge Runtimeが注入
    Deno.env.get('SUPABASE_URL') ?? '',
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: Edge Runtimeが注入
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

/** Authorization ヘッダのJWTからログインユーザーを特定する */
export async function authenticate(
  admin: SupabaseClient,
  req: Request,
): Promise<{ id: string; email: string | null } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!token) return null;
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) return null;
  return { id: user.id, email: user.email ?? null };
}

const PRICE_ENV_BY_PLAN: Record<SubscriptionPlanId, string> = {
  male_1m: 'STRIPE_PRICE_MALE_1M',
  male_3m: 'STRIPE_PRICE_MALE_3M',
  male_6m: 'STRIPE_PRICE_MALE_6M',
};

/** プラン → Stripe Price ID（金額はコードに持たず、Stripe側の登録が正） */
export function priceIdForPlan(plan: SubscriptionPlanId): string {
  return requiredEnv(PRICE_ENV_BY_PLAN[plan]);
}

/** Stripe Price ID → プラン（Webhookで契約内容を読み戻すために使う） */
export function planForPriceId(priceId: string | null | undefined): SubscriptionPlanId | null {
  if (!priceId) return null;
  for (const [plan, envName] of Object.entries(PRICE_ENV_BY_PLAN)) {
    if (Deno.env.get(envName) === priceId) return plan as SubscriptionPlanId;
  }
  return null;
}

/**
 * 契約の「いつまで使えるか」を取り出す。
 *
 * Stripe API 2025-03-31.basil 以降、current_period_end は契約本体ではなく
 * 契約明細（items）側へ移動した。新旧どちらでも動くよう両方を見る。
 */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): string | null {
  const fromItem = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const legacy = sub as unknown as { current_period_end?: number };
  const unix = fromItem?.current_period_end ?? legacy.current_period_end;
  return typeof unix === 'number' ? new Date(unix * 1000).toISOString() : null;
}

/** 契約に紐づく Stripe Customer ID を文字列で取り出す */
export function customerIdOf(sub: Stripe.Subscription): string | null {
  const c = sub.customer;
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object' && 'id' in c) return (c as { id: string }).id;
  return null;
}

/** 契約から Price ID を取り出す */
export function priceIdOf(sub: Stripe.Subscription): string | null {
  return sub.items?.data?.[0]?.price?.id ?? null;
}
