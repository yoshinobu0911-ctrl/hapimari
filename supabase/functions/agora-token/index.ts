/**
 * 通話チャネルへの入場トークンを発行する Edge Function（M8・docs/design/M8_call_design.md §3）
 *
 * 入力: { matchId: string }
 * 成功: { ok: true, appId, channel, uid, token, expiresAt }
 * 失敗: { ok: false, error, message }（message はそのまま利用者に見せてよい日本語）
 *
 * Agora プロジェクトは「App ID + Token（Secured mode）」で作成しているため、
 * ここで発行するトークンが無いと通話チャネルには一切入れない。
 * 発行条件（すべて満たすこと）:
 *   1. ログイン済み・status = 'active'・本人確認済み
 *   2. そのマッチの当事者である
 *   3. マッチがブロックされていない
 *   4. お相手が active かつ本人確認済みである
 * 課金状態は条件にしない（2026-08-19 オーナー決定）。
 * 本人確認は当初「条件にしない」（08-25決定）だったが、出会い系サイト規制法の
 * 年齢確認（児童でないことの確認）を安全側に倒すため「双方とも確認済みのみ」へ変更
 * （2026-08-26 オーナー決定。docs/decisions/2026-08-26_確認前操作の安全側変更.md）。
 *
 * 15分制限はトークンの有効期限（既定16分）で Agora 側からも強制される。
 * クライアントのタイマー（call/[matchId].tsx）は主にUX用で、こちらが最後の砦。
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { RtcRole, RtcTokenBuilder } from 'npm:agora-token@2.0.5';

/** 15分（900秒）＋接続・応答待ちの猶予60秒 */
const DEFAULT_TOKEN_TTL_SECONDS = 960;

// ---- 汎用ヘルパ（_shared/stripe.ts と同型。Stripe SDK を読み込まないためここに持つ） ----

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fail(status: number, error: string, message: string): Response {
  return json(status, { ok: false, error, message });
}

function internalError(): Response {
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

function adminClient(): SupabaseClient {
  return createClient(
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: Edge Runtimeが注入
    Deno.env.get('SUPABASE_URL') ?? '',
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: Edge Runtimeが注入
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

async function authenticate(admin: SupabaseClient, req: Request): Promise<{ id: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!token) return null;
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) return null;
  return { id: user.id };
}

// ---- 本体 ----------------------------------------------------------------

interface MatchRow {
  user_a: string;
  user_b: string;
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

    let body: { matchId?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(400, 'invalid_body', 'リクエストが不正です。');
    }
    const matchId = typeof body.matchId === 'string' ? body.matchId : '';
    if (!matchId) {
      return fail(400, 'invalid_match', 'リクエストが不正です。');
    }

    // --- 資格の確認（設計書 §3）--------------------------------------
    const { data: me } = await admin
      .from('profiles')
      .select('status, is_verified')
      .eq('id', user.id)
      .maybeSingle<{ status: string; is_verified: boolean }>();
    if (me?.status !== 'active') {
      return fail(403, 'not_active', '現在この機能はご利用いただけません。');
    }
    if (me.is_verified !== true) {
      return fail(403, 'not_verified', '本人確認の完了後にご利用いただけます。');
    }

    const { data: match } = await admin
      .from('matches')
      .select('user_a, user_b')
      .eq('id', matchId)
      .maybeSingle<MatchRow>();
    if (!match || (match.user_a !== user.id && match.user_b !== user.id)) {
      // 存在しない・当事者でない、はどちらも「見つからない」として同じ応答にする
      return fail(404, 'not_found', 'この通話はご利用いただけません。');
    }

    const { data: blocked } = await admin.rpc('is_match_blocked', { target_match: matchId });
    if (blocked === true) {
      return fail(403, 'blocked', 'この通話はご利用いただけません。');
    }

    const partnerId = match.user_a === user.id ? match.user_b : match.user_a;
    const { data: partner } = await admin
      .from('profiles')
      .select('status, is_verified')
      .eq('id', partnerId)
      .maybeSingle<{ status: string; is_verified: boolean }>();
    // 相手が退会・凍結、または本人確認未了の間は通話できない（双方確認済みのみ）
    if (partner?.status !== 'active' || partner.is_verified !== true) {
      return fail(410, 'partner_unavailable', '現在おかけになれません。');
    }

    // --- トークン発行 --------------------------------------------------
    const appId = requiredEnv('AGORA_APP_ID');
    const appCertificate = requiredEnv('AGORA_APP_CERTIFICATE');
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: Edge Function の設定値（supabase/functions/.env.example 参照）
    const ttlRaw = Number(Deno.env.get('AGORA_TOKEN_TTL_SECONDS') ?? '');
    const ttl =
      Number.isFinite(ttlRaw) && ttlRaw >= 60 && ttlRaw <= 3600
        ? ttlRaw
        : DEFAULT_TOKEN_TTL_SECONDS;

    // チャネル名 = matchId、uid = 本人のユーザーID（文字列アカウント方式）
    const token = RtcTokenBuilder.buildTokenWithUserAccount(
      appId,
      appCertificate,
      matchId,
      user.id,
      RtcRole.PUBLISHER,
      ttl,
      ttl,
    );

    return json(200, {
      ok: true,
      appId,
      channel: matchId,
      uid: user.id,
      token,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    });
  } catch (e) {
    // シークレットが誤ってログへ出ないよう、メッセージのみを記録する
    console.error('agora-token failed', e instanceof Error ? e.message : 'unknown');
    return internalError();
  }
});
