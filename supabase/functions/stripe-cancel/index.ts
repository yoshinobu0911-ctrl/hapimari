/**
 * 解約（および解約の取り消し・状態の再照合）Edge Function（M7.1・設計書 §5.3）
 * 2026-09-24改訂: 決済修正設計提案§9.4
 *
 * 入力: {}                → 期間末での解約を予約する
 *       { resume: true }  → 解約予約を取り消す
 *       { refresh: true } → Stripeの契約を変更せず、現在の終了状態をDBへ同期するだけ（新規）
 * 成功: { ok: true, cancelAtPeriodEnd: boolean, currentPeriodEnd: string | null }
 *       refresh時: { ok: true, ended: boolean }
 *
 * 方針: **即時停止はしない。** すでに支払い済みの期間の終わりまでは利用できる。
 *       日割り返金の判断を挟まずに済み、返金トラブルを避けられるため。
 *
 * 2026-09-24追加の理由: 決済修正§9.5で退会ガードを追加し、§9.5-2で期限掃除の
 * status書き換えをやめた結果、Webhookを取りこぼして「Stripe上は終了済みなのに
 * DBはpast_due等のまま」固着した会員は、解約（常に500だった）も退会（ガードで拒否）も
 * できなくなる。この関数にStripeへの照会・同期を持たせることで固着から抜け出せるようにする。
 */
import {
  adminClient,
  authenticate,
  corsHeaders,
  fail,
  internalError,
  json,
  LIVE_SUBSCRIPTION_STATUSES,
  listAllSubscriptions,
  type Stripe,
  stripeClient,
  subscriptionPeriodEnd,
} from '../_shared/stripe.ts';

interface SubscriptionRow {
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
}

/** Stripeのエラーが「契約IDが存在しない」を示すか（型に依存しないダックタイピング判定） */
function isResourceMissing(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && (e as { code?: string }).code === 'resource_missing'
  );
}

/**
 * Stripe上でこの契約が本当に終了しているかを確認し、確認できればDBを同期する。
 * 戻り値: 'ended'（同期済み・終了確認できた） / 'still_live'（まだ稼働中） / 'unknown'（確認できなかった）
 */
async function reconcileTermination(
  admin: ReturnType<typeof adminClient>,
  stripe: Stripe,
  userId: string,
  row: SubscriptionRow,
): Promise<'ended' | 'still_live' | 'unknown'> {
  let currentStatus: string;
  let updated: Stripe.Subscription | null = null;

  if (!row.stripe_subscription_id) return 'unknown';

  try {
    updated = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    currentStatus = updated.status;
  } catch (e) {
    if (!isResourceMissing(e)) {
      console.error('stripe-cancel: retrieve failed', e instanceof Error ? e.message : 'unknown');
      return 'unknown';
    }
    // 契約IDがStripeに存在しない。キーの取り違え等でも同じエラーになるため、
    // 同じキーでCustomerが引けることを確認できた場合だけ「終了」として扱う
    try {
      await stripe.customers.retrieve(row.stripe_customer_id);
    } catch (customerError) {
      console.error(
        'stripe-cancel: customer retrieve failed after resource_missing',
        customerError instanceof Error ? customerError.message : 'unknown',
      );
      return 'unknown';
    }
    currentStatus = 'canceled';
  }

  if (currentStatus !== 'canceled' && currentStatus !== 'incomplete_expired') {
    return 'still_live';
  }

  // Customer全体を確認する。DBの記録が抜けている別の稼働契約があれば、勝手にcanceledへ倒さない
  let live: Stripe.Subscription[];
  try {
    live = await listAllSubscriptions(stripe, row.stripe_customer_id);
  } catch (e) {
    console.error(
      'stripe-cancel: listAllSubscriptions failed',
      e instanceof Error ? e.message : 'unknown',
    );
    return 'unknown';
  }
  const otherLive = live.filter(
    (s) => s.id !== row.stripe_subscription_id && LIVE_SUBSCRIPTION_STATUSES.has(s.status),
  );
  if (otherLive.length > 0) {
    console.error(
      'stripe-cancel: customer has other live subscriptions, refusing to mark canceled',
      row.stripe_customer_id,
      otherLive.map((s) => s.id),
    );
    return 'unknown';
  }

  const eventCreated = Math.floor(Date.now() / 1000);
  const patch: Record<string, unknown> = {
    status: currentStatus,
    cancel_at_period_end: updated
      ? updated.cancel_at_period_end === true
      : row.cancel_at_period_end,
    current_period_end: updated ? subscriptionPeriodEnd(updated) : row.current_period_end,
    last_event_created: eventCreated,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from('subscriptions')
    .update(patch)
    .eq('user_id', userId)
    .eq('stripe_subscription_id', row.stripe_subscription_id)
    .or(`last_event_created.is.null,last_event_created.lte.${eventCreated}`)
    .select('user_id');
  if (error) {
    console.error('stripe-cancel: sync update failed', error.code);
    return 'unknown';
  }
  if (!data || data.length === 0) {
    // Webhookが同時に別内容へ更新した等。行を読み直して現在の判定材料にする
    const { data: reread } = await admin
      .from('subscriptions')
      .select('status')
      .eq('user_id', userId)
      .maybeSingle<{ status: string }>();
    if (reread?.status === 'canceled' || reread?.status === 'incomplete_expired') return 'ended';
    return 'unknown';
  }
  return 'ended';
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
    let refresh = false;
    try {
      const parsedBody = (await req.json()) as { resume?: unknown; refresh?: unknown };
      resume = parsedBody?.resume === true;
      refresh = parsedBody?.refresh === true;
    } catch {
      resume = false;
      refresh = false;
    }

    const { data: row } = await admin
      .from('subscriptions')
      .select(
        'stripe_customer_id, stripe_subscription_id, status, cancel_at_period_end, current_period_end',
      )
      .eq('user_id', user.id)
      .maybeSingle<SubscriptionRow>();

    if (!row?.stripe_subscription_id) {
      return fail(404, 'no_subscription', '現在ご登録中のプランはありません。');
    }
    if (row.status === 'canceled' || row.status === 'incomplete_expired') {
      return fail(409, 'already_canceled', 'このプランはすでに終了しています。');
    }

    const stripe = stripeClient();

    if (refresh) {
      const outcome = await reconcileTermination(admin, stripe, user.id, row);
      if (outcome === 'ended') {
        return fail(409, 'already_canceled', 'このプランはすでに終了しています。');
      }
      if (outcome === 'still_live') {
        return json(200, { ok: true, ended: false });
      }
      return internalError();
    }

    let updated: Stripe.Subscription;
    try {
      updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
        cancel_at_period_end: !resume,
      });
    } catch (e) {
      console.error('stripe-cancel: update failed', e instanceof Error ? e.message : 'unknown');
      // 2026-09-24追加: 即500にせず、Stripe上で既に終了していないか確認する。
      // 終了済みの契約はStripeが更新自体を拒否するため、確認しないと解約も退会もできなくなる。
      const outcome = await reconcileTermination(admin, stripe, user.id, row);
      if (outcome === 'ended') {
        return fail(409, 'already_canceled', 'このプランはすでに終了しています。');
      }
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
