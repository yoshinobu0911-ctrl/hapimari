/**
 * 解約（および解約の取り消し）Edge Function（M7.1・設計書 §5.3）
 *
 * 入力: {}                → 期間末での解約を予約する
 *       { resume: true }  → 解約予約を取り消す
 * 成功: { ok: true, cancelAtPeriodEnd: boolean, currentPeriodEnd: string | null }
 *
 * 方針: **即時停止はしない。** すでに支払い済みの期間の終わりまでは利用できる。
 *       日割り返金の判断を挟まずに済み、返金トラブルを避けられるため。
 */
import {
  adminClient,
  authenticate,
  corsHeaders,
  fail,
  internalError,
  json,
  type Stripe,
  stripeClient,
  subscriptionPeriodEnd,
} from '../_shared/stripe.ts';

interface SubscriptionRow {
  stripe_subscription_id: string | null;
  status: string;
  cancel_at_period_end: boolean;
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

    // 本文は任意（空でも解約として扱う）
    let resume = false;
    try {
      const body = (await req.json()) as { resume?: unknown };
      resume = body?.resume === true;
    } catch {
      resume = false;
    }

    const { data: row } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id, status, cancel_at_period_end, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle<SubscriptionRow>();

    if (!row?.stripe_subscription_id) {
      return fail(404, 'no_subscription', '現在ご登録中のプランはありません。');
    }
    if (row.status === 'canceled' || row.status === 'incomplete_expired') {
      return fail(409, 'already_canceled', 'このプランはすでに終了しています。');
    }

    const stripe = stripeClient();
    let updated: Stripe.Subscription;
    try {
      updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
        cancel_at_period_end: !resume,
      });
    } catch (e) {
      console.error('stripe-cancel: update failed', e instanceof Error ? e.message : 'unknown');
      return internalError();
    }

    // 画面へ即座に反映するため先に書き戻す。
    // 正式な同期は Webhook（customer.subscription.updated）が改めて行う。
    await admin
      .from('subscriptions')
      .update({
        cancel_at_period_end: updated.cancel_at_period_end === true,
        current_period_end: subscriptionPeriodEnd(updated),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    return json(200, {
      ok: true,
      cancelAtPeriodEnd: updated.cancel_at_period_end === true,
      currentPeriodEnd: subscriptionPeriodEnd(updated),
    });
  } catch (e) {
    console.error('stripe-cancel failed', e instanceof Error ? e.message : 'unknown');
    return internalError();
  }
});
