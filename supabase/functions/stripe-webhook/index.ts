/**
 * Stripe からの決済結果を受け取る Webhook（M7.1・設計書 §5.2／M7.3・決済修正§9.2）
 *
 * **課金状態（subscriptions テーブル）を書き換えられる唯一の経路。**
 * 利用者は subscriptions に INSERT/UPDATE/DELETE の権限を持たないため、
 * 「支払っていないのに有料になる」経路はここを突破する以外に存在しない。
 *
 * 安全性の柱:
 *   1. 署名検証 … Stripe の署名を検証するまで本文を一切信用しない
 *   2. 冪等処理 … stripe_events.processed_at が立つまでは「未処理」（2026-09-24改訂）
 *   3. 順序保証 … last_event_created より古い通知で契約状態を巻き戻さない
 *   4. リトライ … 処理に失敗したら 500 を返し、Stripe に再送させる（行は消さない）
 *
 * この関数は JWT 認証を通さない（Stripe はJWTを持たない）。
 * supabase/config.toml で verify_jwt = false を明示している。
 *
 * 2026-09-24 改訂（決済修正設計提案§9.2・PR#1統合指摘 I06/I07/I34）:
 *   旧実装は「stripe_events への insert 成功」だけを冪等性の根拠にし、処理失敗時は
 *   その行を delete していた。これは輻輳配送（Stripeが応答待ちでタイムアウトし
 *   そのまま再送する）に弱く、1本目が処理中に2本目が届くと2本目は insert 重複で
 *   即 200 を返す→Stripeは満足し再送しない→その後1本目が失敗して行を delete→
 *   「どこにも記録が残らないまま処理済みと伝えてしまう」事故が起こり得た。
 *   processed_at 方式（NULL=未処理・非NULL=処理済み・行は消さない）に切り替える。
 */
import {
  adminClient,
  customerIdOf,
  internalError,
  json,
  LIVE_SUBSCRIPTION_STATUSES,
  listAllSubscriptions,
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
 * 自動判断できない異常（対応ユーザー不明・別契約IDの再昇格を確認できない等）。
 * 通常のDBエラー等（一時的で再送により解消しうる）とは区別し、呼び出し元で
 * stripe_events.needs_review=true を立てる判断材料にする。
 */
class NeedsReviewError extends Error {}

interface CurrentRow {
  stripe_subscription_id: string | null;
  last_event_created: number | null;
}

/** 対象ユーザーのDB行を取得する（無ければ null） */
async function fetchCurrentRow(admin: Admin, userId: string): Promise<CurrentRow | null> {
  const { data } = await admin
    .from('subscriptions')
    .select('stripe_subscription_id, last_event_created')
    .eq('user_id', userId)
    .maybeSingle<CurrentRow>();
  return data ?? null;
}

/** metadata → Stripe Customer ID の順でユーザーを特定する。どちらも不可なら NeedsReviewError */
async function resolveUserId(admin: Admin, sub: Stripe.Subscription): Promise<string> {
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
    throw new NeedsReviewError(`cannot resolve user for subscription ${sub.id}`);
  }
  return userId;
}

/**
 * 別の契約IDへ切り替えてよいかをStripeに照会して確認する（I07・別ID再昇格対策）。
 * 確認できた場合のみ true。確認できない場合は、二重契約の疑いとして新しい方の
 * 停止を試みたうえで false を返す（呼び出し元は needs_review を立てて同期しない）。
 */
async function confirmSubscriptionSwitch(
  stripe: Stripe,
  customerId: string | null,
  oldSubId: string,
  newSub: Stripe.Subscription,
): Promise<boolean> {
  if (!customerId) return false;
  let all: Stripe.Subscription[];
  try {
    all = await listAllSubscriptions(stripe, customerId);
  } catch (e) {
    console.error('webhook: listAllSubscriptions failed', e instanceof Error ? e.message : '');
    return false;
  }

  const oldStillLive = all.some(
    (s) => s.id === oldSubId && LIVE_SUBSCRIPTION_STATUSES.has(s.status),
  );
  const liveEntitled = all
    .filter((s) => s.status === 'active' || s.status === 'trialing')
    .sort((a, b) => b.created - a.created);
  const newIsLatest = liveEntitled.length > 0 && liveEntitled[0].id === newSub.id;

  if (oldStillLive || !newIsLatest) {
    // 旧契約がまだ生きている、または新しい方が最新の稼働契約ではない
    // ＝二重契約の疑い。新しい方を止める（層3と同じ扱い）。失敗しても続行（要確認扱いにする）。
    try {
      await stripe.subscriptions.cancel(newSub.id);
      console.warn('webhook: ambiguous reactivation, canceled newer subscription', newSub.id);
    } catch (e) {
      console.error(
        'webhook: failed to cancel ambiguous newer subscription',
        newSub.id,
        e instanceof Error ? e.message : '',
      );
    }
    return false;
  }
  return true;
}

type SyncOutcome = 'applied' | 'stale';

/**
 * Stripe の契約内容を subscriptions テーブルへ反映する。
 * 戻り値: 'applied'=DBを更新した / 'stale'=順序ガードにより意図的に何もしなかった（正常）
 */
async function syncSubscription(
  admin: Admin,
  stripe: Stripe,
  sub: Stripe.Subscription,
  eventCreated: number,
  forcedStatus?: string,
): Promise<SyncOutcome> {
  const customerId = customerIdOf(sub);
  const userId = await resolveUserId(admin, sub);

  const rawStatus = forcedStatus ?? sub.status;
  const status = KNOWN_STATUSES.has(rawStatus) ? rawStatus : 'incomplete';
  const plan = planForPriceId(priceIdOf(sub));
  const entitledIncoming = status === 'active' || status === 'trialing';

  const currentRow = await fetchCurrentRow(admin, userId);
  if (!currentRow) {
    // checkout時点で必ず行が作られているはずなので、無いのは想定外
    throw new NeedsReviewError(`no subscriptions row for user ${userId}`);
  }

  let resetEventCreated = false;
  if (currentRow.stripe_subscription_id && currentRow.stripe_subscription_id !== sub.id) {
    if (!entitledIncoming) {
      // 旧契約の残響（無効化系イベント）。今の契約を上書きしない
      console.warn('webhook: stale event for replaced subscription ignored', sub.id);
      return 'stale';
    }
    // 別IDへの切り替え。無条件採用はせず、Stripe側で確認できた場合のみ進める
    const confirmed = await confirmSubscriptionSwitch(
      stripe,
      customerId,
      currentRow.stripe_subscription_id,
      sub,
    );
    if (!confirmed) {
      throw new NeedsReviewError(
        `ambiguous subscription switch ${currentRow.stripe_subscription_id} -> ${sub.id}`,
      );
    }
    console.warn('webhook: subscription replaced', currentRow.stripe_subscription_id, '->', sub.id);
    resetEventCreated = true; // 契約IDが変わるので順序ガードの起点をリセットする
  }

  const patch: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    status,
    current_period_end: subscriptionPeriodEnd(sub),
    cancel_at_period_end: sub.cancel_at_period_end === true,
    last_event_created: eventCreated,
    updated_at: new Date().toISOString(),
  };
  if (plan) patch.plan = plan; // Price ID が未知のときは既存プランを保持する
  if (customerId) patch.stripe_customer_id = customerId;

  // 順序ガード（I07）: 契約IDが変わらない限り、記録済みより古い event.created では更新しない。
  // 1文のUPDATE...WHEREで判定と書き込みを同時に行い、読み取りから書き込みまでの間の競合を避ける。
  let query = admin.from('subscriptions').update(patch).eq('user_id', userId);
  if (!resetEventCreated) {
    query = query.or(`last_event_created.is.null,last_event_created.lte.${eventCreated}`);
  }
  const { data, error } = await query.select('user_id');
  if (error) throw new Error(`subscriptions update failed: ${error.code}`);

  if (!data || data.length === 0) {
    // ガードに阻まれた＝記録済みより古い通知。適用不要として正常終了する
    console.warn('webhook: stale event by last_event_created guard, skipped', sub.id, eventCreated);
    return 'stale';
  }

  // profiles.subscription_active は DBトリガ（trg_sync_subscription_flag）が自動同期する
  return 'applied';
}

/**
 * checkout.session.completed / customer.subscription.* / checkout.session.expired の後始末。
 * pending_checkout_session_id を、DB行がそのSessionの契約を指している（＝契約同期が済んだ）か、
 * その契約の終了をStripeで確認できた場合だけNULLへ戻す（§9.2-7）。
 */
async function clearPendingForCompletedSession(
  admin: Admin,
  sessionId: string,
  subId: string,
): Promise<void> {
  await admin
    .from('subscriptions')
    .update({ pending_checkout_session_id: null })
    .eq('pending_checkout_session_id', sessionId)
    .eq('stripe_subscription_id', subId);
}

async function clearPendingForExpiredSession(admin: Admin, sessionId: string): Promise<void> {
  await admin
    .from('subscriptions')
    .update({ pending_checkout_session_id: null })
    .eq('pending_checkout_session_id', sessionId);
}

/** customer.subscription.* 受信時、DBのpendingが「この契約に対応するSession」だと確認できれば消す */
async function clearPendingIfMatchesSubscription(
  admin: Admin,
  stripe: Stripe,
  sub: Stripe.Subscription,
): Promise<void> {
  const { data } = await admin
    .from('subscriptions')
    .select('pending_checkout_session_id')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle<{ pending_checkout_session_id: string | null }>();
  const pending = data?.pending_checkout_session_id ?? null;
  if (!pending?.startsWith('cs_')) return; // 予約中トークン(reserving:)は消さない

  try {
    const session = await stripe.checkout.sessions.retrieve(pending);
    if (session.status === 'complete' && session.subscription === sub.id) {
      await clearPendingForCompletedSession(admin, pending, sub.id);
    }
  } catch (e) {
    // 取得失敗時は何もしない。後続の checkout.session.completed か次回同期に任せる
    console.warn('webhook: pending session retrieve failed', e instanceof Error ? e.message : '');
  }
}

async function handleEvent(admin: Admin, stripe: Stripe, event: Stripe.Event): Promise<void> {
  const eventCreated = event.created;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId =
        typeof session.subscription === 'string'
          ? session.subscription
          : (session.subscription?.id ?? null);
      if (!subId) return;

      // セッションには契約の全情報が載らないため、契約そのものを取り直す
      const sub = await stripe.subscriptions.retrieve(subId);
      // 決済開始時のユーザーIDを確実に引き継ぐ
      if (!sub.metadata?.supabase_user_id) {
        const fallback =
          (session.metadata?.supabase_user_id as string | undefined) ??
          session.client_reference_id ??
          undefined;
        if (fallback) sub.metadata = { ...sub.metadata, supabase_user_id: fallback };
      }
      await syncSubscription(admin, stripe, sub, eventCreated);
      if (session.id) await clearPendingForCompletedSession(admin, session.id, subId);
      return;
    }

    case 'checkout.session.expired': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.id) await clearPendingForExpiredSession(admin, session.id);
      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscription(admin, stripe, sub, eventCreated);
      await clearPendingIfMatchesSubscription(admin, stripe, sub);
      return;
    }

    case 'customer.subscription.deleted': {
      // 契約終了。status を canceled に固定して反映する
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscription(admin, stripe, sub, eventCreated, 'canceled');
      await clearPendingIfMatchesSubscription(admin, stripe, sub);
      return;
    }

    case 'invoice.payment_failed': {
      // 2026-09-24改訂（I34）: 名前だけでpast_dueに固定せず、契約の現在状態を取り直して同期する。
      // 支払成功後に遅着した失敗通知でも、Stripeの現在activeを維持できるようにするため。
      const invoice = event.data.object as {
        id?: string;
        subscription?: string | { id: string } | null;
      };
      const subId =
        typeof invoice.subscription === 'string'
          ? invoice.subscription
          : (invoice.subscription?.id ?? null);
      if (!subId) {
        console.warn(
          'webhook: invoice.payment_failed without subscription, ignored',
          invoice.id ?? '',
        );
        return;
      }
      const sub = await stripe.subscriptions.retrieve(subId);
      await syncSubscription(admin, stripe, sub, eventCreated);
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

  const stripe = stripeClient();
  let event: Stripe.Event;
  try {
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

  // 冪等: 先に event.id を processed_at=NULL で記録する。
  // 2026-09-24改訂: 重複時は processed_at を確認する（行の存在だけでは「処理済み」としない）。
  const { error: insertError } = await admin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type, processed_at: null });
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: existing } = await admin
        .from('stripe_events')
        .select('processed_at')
        .eq('id', event.id)
        .maybeSingle<{ processed_at: string | null }>();
      if (existing?.processed_at) {
        return json(200, { ok: true, duplicate: true });
      }
      // processed_at が NULL＝前回失敗 or 処理中。再実行して安全（syncSubscriptionの各ガードが対策）
    } else {
      console.error('webhook: stripe_events insert failed', insertError.code);
      return internalError();
    }
  }

  let needsReview = false;
  try {
    await handleEvent(admin, stripe, event);
  } catch (e) {
    if (e instanceof NeedsReviewError) {
      needsReview = true;
      console.error('webhook: needs_review', e.message);
    } else {
      // 行は消さない。processed_at は NULL のまま500を返し、Stripeの再送で再処理する
      console.error('webhook: handler failed', e instanceof Error ? e.message : 'unknown');
      return internalError();
    }
  }

  // 確定: 対象1行の反映（または意図的なstale/needs_review判定）を終えた後にだけ processed_at を立てる
  const { error: finalizeError } = await admin
    .from('stripe_events')
    .update({ processed_at: new Date().toISOString(), needs_review: needsReview })
    .eq('id', event.id);
  if (finalizeError) {
    console.error('webhook: finalize failed', finalizeError.code);
    return internalError();
  }

  return json(200, { ok: true, needsReview });
});
