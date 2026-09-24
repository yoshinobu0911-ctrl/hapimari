/**
 * 決済ページ（Stripe Checkout）のURLを発行する Edge Function
 * 設計書: docs/design/M7_1_payment_design.md §5.1
 * 2026-09-24改訂: 決済修正設計提案§9.3（PR#1統合指摘 I23/I24/I26）
 *
 * 入力: { plan: 'male_1m' | 'male_3m' | 'male_6m' }
 * 成功: { ok: true, url: string }   … このURLへブラウザで遷移させる
 * 失敗: { ok: false, error: string, message: string }
 *
 * ここでは DB を「有料」に書き換えない。有料化は必ず stripe-webhook 経由で行う。
 *
 * 二重契約対策の3層（設計書§3.3）:
 *   層1: Checkout作成前にStripe側の実態を照合する
 *   層2: 開いているCheckoutを1枚に保つ（pending_checkout_session_id）
 *   層3: それでも二重に成立したら新しい方を止める（stripe-webhook側で実施）
 */
import {
  adminClient,
  authenticate,
  corsHeaders,
  fail,
  internalError,
  isSubscriptionPlanId,
  json,
  listAllSubscriptions,
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

/** 予約トークン（`reserving:`）を放置とみなすまでの時間。Stripe API 1往復分の余裕を見て2分 */
const RESERVATION_TIMEOUT_MS = 2 * 60 * 1000;

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
  pending_checkout_session_id: string | null;
  updated_at: string;
}

function isRealCustomerId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith('cus_');
}

function isReservingToken(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.startsWith('reserving:');
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
      .select(
        'stripe_customer_id, stripe_subscription_id, status, current_period_end, pending_checkout_session_id, updated_at',
      )
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

    // --- 層2: 開いているCheckoutの再利用 ------------------------------
    if (existing?.pending_checkout_session_id) {
      const pending = existing.pending_checkout_session_id;
      if (isReservingToken(pending)) {
        const age = Date.now() - new Date(existing.updated_at).getTime();
        if (age < RESERVATION_TIMEOUT_MS) {
          return fail(
            425,
            'checkout_in_progress',
            '決済の準備中です。少し時間をおいてから、もう一度お試しください。',
          );
        }
        // 2分以上前の予約は放置とみなし、下の予約ステップで自分が引き継ぐ
      } else {
        let session: Stripe.Checkout.Session;
        try {
          session = await stripe.checkout.sessions.retrieve(pending);
        } catch (e) {
          console.error(
            'stripe-checkout: pending session retrieve failed',
            e instanceof Error ? e.message : 'unknown',
          );
          return internalError();
        }
        if (session.status === 'open' && session.url) {
          return json(200, { ok: true, url: session.url });
        }
        if (session.status === 'complete') {
          await admin
            .from('subscriptions')
            .update({ pending_checkout_session_id: null })
            .eq('user_id', user.id)
            .eq('pending_checkout_session_id', pending);
          return fail(409, 'already_subscribed', 'すでにご登録済みです。');
        }
        // expired（またはその他の終端状態）: 後始末して予約ステップへ進む
        await admin
          .from('subscriptions')
          .update({ pending_checkout_session_id: null })
          .eq('user_id', user.id)
          .eq('pending_checkout_session_id', pending);
      }
    }

    // --- 層1: Checkout作成前にStripe側の実態を照合する ------------------
    if (isRealCustomerId(existing?.stripe_customer_id)) {
      let live: Stripe.Subscription[];
      try {
        live = await listAllSubscriptions(stripe, existing.stripe_customer_id);
      } catch (e) {
        console.error(
          'stripe-checkout: listAllSubscriptions failed',
          e instanceof Error ? e.message : 'unknown',
        );
        return internalError();
      }
      if (live.some((s) => s.status === 'active' || s.status === 'trialing')) {
        // Stripe側は既に有効。DB反映はwebhookに任せ、ここでは案内だけする
        return fail(409, 'already_subscribed', 'すでにご登録済みです。');
      }
      if (live.some((s) => s.status === 'incomplete')) {
        return fail(
          409,
          'checkout_in_progress',
          '決済処理中です。少し時間をおいてから、もう一度お試しください。',
        );
      }
    }

    // --- 残存契約の後始末（§9-1）--------------------------------------
    // 更新決済に失敗した旧契約（past_due 等）が残ったまま新規Checkoutを作らせない。
    // 2026-09-24改訂（I26）: 終了を確認できない限り、新規Checkoutへは進まない（握りつぶさない）。
    if (existing?.stripe_subscription_id && REPLACEABLE_STATUSES.has(existing.status)) {
      try {
        await stripe.subscriptions.cancel(existing.stripe_subscription_id);
      } catch (e) {
        console.warn(
          'stripe-checkout: old subscription cancel failed, verifying current state',
          e instanceof Error ? e.message : 'unknown',
        );
        try {
          const check = await stripe.subscriptions.retrieve(existing.stripe_subscription_id);
          if (check.status !== 'canceled' && check.status !== 'incomplete_expired') {
            return fail(
              409,
              'old_subscription_active',
              '既存のお手続きが完了していません。少し時間をおいてから、もう一度お試しください。',
            );
          }
        } catch (retrieveError) {
          console.error(
            'stripe-checkout: old subscription retrieve failed',
            retrieveError instanceof Error ? retrieveError.message : 'unknown',
          );
          return internalError();
        }
      }
    }

    // --- 層2: 予約（claim）------------------------------------------
    // 同時に届いた複数リクエストのうち1件だけが先へ進めるようにする（I23・I24）。
    const claimToken = `reserving:${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    const reservationCutoffIso = new Date(Date.now() - RESERVATION_TIMEOUT_MS).toISOString();

    let customerId: string | null = isRealCustomerId(existing?.stripe_customer_id)
      ? existing.stripe_customer_id
      : null;
    let claimed = false;

    if (!existing) {
      // 新規顧客: INSERT自体を予約にする。stripe_customer_idは一時的にclaimTokenを入れ、
      // Stripe Customer作成後に本物のIDへ更新する（列はNOT NULLのため）。
      const { error: insertError } = await admin.from('subscriptions').insert({
        user_id: user.id,
        stripe_customer_id: claimToken,
        pending_checkout_session_id: claimToken,
        plan,
        status: 'incomplete',
      });
      if (!insertError) {
        claimed = true;
      } else if (insertError.code !== '23505') {
        console.error('stripe-checkout: subscriptions insert failed', insertError.code);
        return internalError();
      }
      // 23505（PK競合）＝ほぼ同時に別リクエストが先にinsertした。下の条件付きUPDATEに委ねる
    }

    if (!claimed) {
      const { data: claimedRow } = await admin
        .from('subscriptions')
        .update({ pending_checkout_session_id: claimToken, updated_at: nowIso })
        .eq('user_id', user.id)
        .or(
          `pending_checkout_session_id.is.null,and(pending_checkout_session_id.like.reserving:*,updated_at.lt.${reservationCutoffIso})`,
        )
        .select('user_id, stripe_customer_id')
        .maybeSingle<{ user_id: string; stripe_customer_id: string }>();
      if (!claimedRow) {
        return fail(
          425,
          'checkout_in_progress',
          '決済の準備中です。少し時間をおいてから、もう一度お試しください。',
        );
      }
      claimed = true;
      customerId = isRealCustomerId(claimedRow.stripe_customer_id)
        ? claimedRow.stripe_customer_id
        : null;
    }

    // --- Stripe Customer（初回のみ作成し、以後は使い回す）----------------
    // 冪等キーは利用者単位で固定する（Customerは1人1つだけ作る操作のため、再試行しても同じ結果を返す）
    if (!customerId) {
      let customer: Stripe.Customer;
      try {
        customer = await stripe.customers.create(
          { email: user.email ?? undefined, metadata: { supabase_user_id: user.id } },
          { idempotencyKey: `hapimari-customer-${user.id}` },
        );
      } catch (e) {
        console.error(
          'stripe-checkout: customer create failed',
          e instanceof Error ? e.message : 'unknown',
        );
        return internalError();
      }
      customerId = customer.id;
      await admin
        .from('subscriptions')
        .update({ stripe_customer_id: customerId, plan, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('pending_checkout_session_id', claimToken);
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

    let session: Stripe.Checkout.Session;
    try {
      // 冪等キーはこの予約(claimToken)単位。同じ予約からの再試行は同じSessionを返す
      session = await stripe.checkout.sessions.create(params, {
        idempotencyKey: `hapimari-checkout-${claimToken}`,
      });
    } catch (e) {
      console.error(
        'stripe-checkout: session create failed',
        e instanceof Error ? e.message : 'unknown',
      );
      // 予約は解放しない。2分後に自分か次のリクエストが引き継げる（Stripe側の重複作成を避けるため）
      return internalError();
    }
    if (!session.url) {
      console.error('checkout session has no url');
      return internalError();
    }

    // --- 確定: 予約トークンを実Session IDへ置き換える -------------------
    const { error: confirmError } = await admin
      .from('subscriptions')
      .update({ pending_checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('pending_checkout_session_id', claimToken);
    if (confirmError) {
      console.error('stripe-checkout: confirm update failed', confirmError.code);
      // Sessionは作成済みでURLも払い出せるため、利用者へは成功として返す。
      // pendingはclaimTokenのままだが2分後には次の試行が引き継げる（不変条件は崩れない）
    }

    return json(200, { ok: true, url: session.url });
  } catch (e) {
    // シークレットが誤ってログへ出ないよう、メッセージのみを記録する
    console.error('stripe-checkout failed', e instanceof Error ? e.message : 'unknown');
    return internalError();
  }
});
