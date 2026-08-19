/**
 * Stripe からの決済結果を受け取る Webhook（M7.1・設計書 §5.2）
 *
 * **課金状態（subscriptions テーブル）を書き換えられる唯一の経路。**
 * 利用者は subscriptions に INSERT/UPDATE/DELETE の権限を持たないため、
 * 「支払っていないのに有料になる」経路はここを突破する以外に存在しない。
 *
 * 安全性の3本柱:
 *   1. 署名検証 … Stripe の署名を検証するまで本文を一切信用しない
 *   2. 冪等処理 … 同じ event.id は二度処理しない（期間の二重延長を防ぐ）
 *   3. リトライ … 処理に失敗したら 500 を返し、Stripe に再送させる
 *
 * この関数は JWT 認証を通さない（Stripe はJWTを持たない）。
 * supabase/config.toml で verify_jwt = false を明示している。
 */
import {
  adminClient,
  customerIdOf,
  internalError,
  json,
  planForPriceId,
  priceIdOf,
  Stripe,
  stripeClient,
  subscriptionPeriodEnd,
} from '../_shared/stripe.ts';

// Deno では同期の暗号APIが使えないため、SubtleCrypto 版のプロバイダを使う
const cryptoProvider = Stripe.createSubtleCryptoProvider();

/** Stripe の subscription.status のうち、DBの check 制約が受け付ける値 */
const KNOWN_STATUSES = new Set([
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
]);

type Admin = ReturnType<typeof adminClient>;

/**
 * Stripe の契約内容を subscriptions テーブルへ反映する。
 * 対象ユーザーは metadata（決済開始時に埋め込んだSupabaseのユーザーID）で特定し、
 * 取れない場合は Stripe Customer ID から引き当てる。
 */
async function syncSubscription(
  admin: Admin,
  sub: Stripe.Subscription,
  forcedStatus?: string,
): Promise<void> {
  const customerId = customerIdOf(sub);
  let userId = (sub.metadata?.supabase_user_id as string | undefined) ?? null;

  if (!userId && customerId) {
    const { data } = await admin
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle<{ user_id: string }>();
    userId = data?.user_id ?? null;
  }
  if (!userId) {
    // 該当ユーザーを特定できない通知は、再送しても解決しないため処理済みとして流す
    console.error('webhook: cannot resolve user for subscription', sub.id);
    return;
  }

  const rawStatus = forcedStatus ?? sub.status;
  const status = KNOWN_STATUSES.has(rawStatus) ? rawStatus : 'incomplete';
  const plan = planForPriceId(priceIdOf(sub));

  // --- 契約の置き換え対策（M7.2 §9-1 の随伴修正）------------------------
  // stripe-checkout は past_due 等の旧契約をキャンセルしてから新契約を作る。
  // このとき「旧契約の終了通知」が「新契約の反映」より後に届く可能性があり、
  // 素通しすると有効な新契約を canceled で上書きしてしまう（支払った人が使えなくなる）。
  // 行がすでに別の契約IDを指している場合、無効化系のイベントは古い契約の残響とみなして捨てる。
  // 有効化（active / trialing）だけは新しい契約への置き換えとして常に通す。
  const entitledIncoming = status === 'active' || status === 'trialing';
  const { data: currentRow } = await admin
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', userId)
    .maybeSingle<{ stripe_subscription_id: string | null }>();
  if (
    currentRow?.stripe_subscription_id &&
    currentRow.stripe_subscription_id !== sub.id &&
    !entitledIncoming
  ) {
    console.warn('webhook: stale event for replaced subscription ignored', sub.id);
    return;
  }
  if (
    currentRow?.stripe_subscription_id &&
    currentRow.stripe_subscription_id !== sub.id &&
    entitledIncoming
  ) {
    // 二重契約の疑い（§6-2）を後から追えるよう記録する。旧契約が生きていれば
    // Stripeダッシュボードでの手動返金・停止の対象になる
    console.warn('webhook: subscription replaced', currentRow.stripe_subscription_id, '->', sub.id);
  }

  const patch: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    status,
    current_period_end: subscriptionPeriodEnd(sub),
    cancel_at_period_end: sub.cancel_at_period_end === true,
    updated_at: new Date().toISOString(),
  };
  if (plan) patch.plan = plan; // Price ID が未知のときは既存プランを保持する
  if (customerId) patch.stripe_customer_id = customerId;

  const { error } = await admin.from('subscriptions').update(patch).eq('user_id', userId);
  if (error) throw new Error(`subscriptions update failed: ${error.code}`);

  // profiles.subscription_active は DBトリガ（trg_sync_subscription_flag）が自動同期する
}

async function handleEvent(admin: Admin, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId =
        typeof session.subscription === 'string'
          ? session.subscription
          : (session.subscription?.id ?? null);
      if (!subId) return;

      // セッションには契約の全情報が載らないため、契約そのものを取り直す
      const stripe = stripeClient();
      const sub = await stripe.subscriptions.retrieve(subId);
      // 決済開始時のユーザーIDを確実に引き継ぐ
      if (!sub.metadata?.supabase_user_id) {
        const fallback =
          (session.metadata?.supabase_user_id as string | undefined) ??
          session.client_reference_id ??
          undefined;
        if (fallback) sub.metadata = { ...sub.metadata, supabase_user_id: fallback };
      }
      await syncSubscription(admin, sub);
      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      await syncSubscription(admin, event.data.object as Stripe.Subscription);
      return;
    }

    case 'customer.subscription.deleted': {
      // 契約終了。status を canceled に固定して反映する
      await syncSubscription(admin, event.data.object as Stripe.Subscription, 'canceled');
      return;
    }

    case 'invoice.payment_failed': {
      // 状態自体は customer.subscription.updated（past_due）で届く。ここでは記録のみ。
      const invoice = event.data.object as { id?: string };
      console.warn('webhook: payment failed', invoice.id ?? '');
      return;
    }

    default:
      // 未対応イベントは正常終了（Stripeに再送させない）
      return;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  const signature = req.headers.get('stripe-signature');
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Edge Function のシークレット（supabase/functions/.env.example 参照）
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!signature || !secret) {
    console.error('webhook: missing signature or STRIPE_WEBHOOK_SECRET');
    return json(400, { ok: false, error: 'bad_request' });
  }

  // 署名検証には生の本文が必要（JSONへパースする前に読む）
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = stripeClient();
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      secret,
      undefined,
      cryptoProvider,
    );
  } catch (e) {
    // 署名が合わない = Stripe からの通知ではない。再送させる意味もないので400。
    console.error('webhook: signature verification failed', e instanceof Error ? e.message : '');
    return json(400, { ok: false, error: 'invalid_signature' });
  }

  const admin = adminClient();

  // 冪等: 先に event.id を記録し、重複なら何もせず 200 を返す
  const { error: dupError } = await admin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });
  if (dupError) {
    if (dupError.code === '23505') {
      return json(200, { ok: true, duplicate: true });
    }
    console.error('webhook: stripe_events insert failed', dupError.code);
    return internalError();
  }

  try {
    await handleEvent(admin, event);
  } catch (e) {
    // 記録を取り消してから500を返す。Stripeの再送で正しく処理し直せるようにする。
    await admin.from('stripe_events').delete().eq('id', event.id);
    console.error('webhook: handler failed', e instanceof Error ? e.message : 'unknown');
    return internalError();
  }

  return json(200, { ok: true });
});
