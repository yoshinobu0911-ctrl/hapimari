/**
 * 決済ページ（Stripe Checkout）のURLを発行する Edge Function
 * 設計書: docs/design/M7_1_payment_design.md §5.1
 *
 * 入力: { plan: 'male_1m' | 'male_3m' | 'male_6m' }
 * 成功: { ok: true, url: string }   … このURLへブラウザで遷移させる
 * 失敗: { ok: false, error: string, message: string }
 *
 * ここでは DB を「有料」に書き換えない。有料化は必ず stripe-webhook 経由で行う。
 */
import {
  adminClient,
  authenticate,
  corsHeaders,
  fail,
  internalError,
  isSubscriptionPlanId,
  json,
  priceIdForPlan,
  type Stripe,
  stripeClient,
} from '../_shared/stripe.ts';

const CHECKOUT_INTEGRATION_ID = 'hapimari-subscription-qmwtzbxk';

/**
 * 新しい決済を始める前に、Stripe側で終了させておく既存契約の状態（M7.2 §9-1）。
 * これらを残したまま新規Checkoutを許すと、Stripe上に契約が2本並び二重課金になる。
 * いずれも「支払いが完了していない」状態のため、終了させても支払い済みの利用期間は失われない。
 * 2026-08-19 オーナー承認。
 */
const REPLACEABLE_STATUSES = new Set(['past_due', 'unpaid', 'paused', 'incomplete']);

/**
 * Checkoutページの有効期限（M7.2 §9-2・2026-08-19 オーナー承認）。
 * 既定の24時間は「置き忘れた決済ページを後から支払って契約が二重になる」窓が広すぎる。
 * Stripeの下限30分に、時計ずれの余裕60秒を足して設定する。
 */
const CHECKOUT_EXPIRES_SECONDS = 30 * 60 + 60;

interface ProfileRow {
  gender: string;
  status: string;
  is_verified: boolean;
}

interface SubscriptionRow {
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return fail(405, 'method_not_allowed', 'POSTのみ対応しています。');
  }

  try {
    const admin = adminClient();

    const user = await authenticate(admin, req);
    if (!user) {
      return fail(401, 'unauthorized', 'ログインし直してください。');
    }

    let body: { plan?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(400, 'invalid_body', 'リクエストが不正です。');
    }
    if (!isSubscriptionPlanId(body.plan)) {
      return fail(400, 'invalid_plan', 'プランの指定が不正です。');
    }
    const plan = body.plan;

    // --- 資格の確認（設計書 §5.1）-------------------------------------
    const { data: profile } = await admin
      .from('profiles')
      .select('gender, status, is_verified')
      .eq('id', user.id)
      .maybeSingle<ProfileRow>();

    if (!profile) {
      return fail(403, 'not_registered', 'プロフィール登録を完了してください。');
    }
    if (profile.status !== 'active') {
      return fail(403, 'not_active', '現在このお手続きはご利用いただけません。');
    }
    if (profile.gender !== 'male') {
      return fail(403, 'not_required', '女性は無料でご利用いただけます。');
    }
    if (profile.is_verified !== true) {
      // 支払っても本人確認前はメッセージを送れない（R2）ため、先に課金させない
      return fail(
        403,
        'not_verified',
        '本人確認の完了後にご登録いただけます。お手続きの完了をお待ちください。',
      );
    }

    const { data: existing } = await admin
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle<SubscriptionRow>();

    const stillValid =
      existing != null &&
      (existing.status === 'active' || existing.status === 'trialing') &&
      existing.current_period_end != null &&
      new Date(existing.current_period_end).getTime() > Date.now();
    if (stillValid) {
      return fail(409, 'already_subscribed', 'すでにご登録済みです。');
    }

    const stripe = stripeClient();

    // --- 残存契約の後始末（§9-1）--------------------------------------
    // 更新決済に失敗した旧契約（past_due 等）が残ったまま新規Checkoutを作らせない。
    // 先に旧契約を終了させてから進む（終了の正式なDB反映は Webhook が行う）。
    if (existing?.stripe_subscription_id && REPLACEABLE_STATUSES.has(existing.status)) {
      try {
        await stripe.subscriptions.cancel(existing.stripe_subscription_id);
      } catch (e) {
        // Stripe側ですでに終了している等。新規契約の妨げにはならないため続行する
        console.warn(
          'stripe-checkout: old subscription cancel skipped',
          e instanceof Error ? e.message : 'unknown',
        );
      }
    }

    // --- Stripe Customer（初回のみ作成し、以後は使い回す）----------------
    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      const { error: insertError } = await admin.from('subscriptions').insert({
        user_id: user.id,
        stripe_customer_id: customerId,
        plan,
        status: 'incomplete',
      });
      if (insertError) {
        console.error('subscriptions insert failed', insertError.code);
        return internalError();
      }
    } else {
      // 既存行はプランの選び直しのみ反映する（status は Webhook だけが更新する）
      await admin
        .from('subscriptions')
        .update({ plan, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    }

    // --- Checkout セッション ------------------------------------------
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: Edge Function のシークレット（supabase/functions/.env.example 参照）
    const baseUrl = Deno.env.get('APP_BASE_URL') ?? '';
    const params = {
      mode: 'subscription',
      customer: customerId,
      // Webhook 側で本人を特定するための紐付け（2系統持たせて取りこぼしを防ぐ）
      client_reference_id: user.id,
      metadata: { supabase_user_id: user.id, plan },
      subscription_data: { metadata: { supabase_user_id: user.id, plan } },
      line_items: [{ price: priceIdForPlan(plan), quantity: 1 }],
      // payment_method_types は指定しない（Stripe側の設定で最適な支払い方法が出る）
      locale: 'ja',
      // 置き忘れた決済ページを短時間で失効させる（§9-2）
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRES_SECONDS,
      success_url: `${baseUrl}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/subscription?checkout=cancel`,
    } as Stripe.Checkout.SessionCreateParams & { integration_identifier?: string };
    params.integration_identifier = CHECKOUT_INTEGRATION_ID;

    const session = await stripe.checkout.sessions.create(params);
    if (!session.url) {
      console.error('checkout session has no url');
      return internalError();
    }

    return json(200, { ok: true, url: session.url });
  } catch (e) {
    // シークレットが誤ってログへ出ないよう、メッセージのみを記録する
    console.error('stripe-checkout failed', e instanceof Error ? e.message : 'unknown');
    return internalError();
  }
});
