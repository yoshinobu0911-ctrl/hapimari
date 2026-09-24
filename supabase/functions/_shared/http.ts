/**
 * Edge Function 共通の HTTP・認証ヘルパ（I17: 各関数に同じ実装が重複していたのを1か所へ）。
 *
 * Stripe SDK などの重い依存は読み込まない（agora-token・like からも使うため）。
 * 決済専用の処理は _shared/stripe.ts に残し、そこからこのファイルを再公開している。
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

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

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    // 値そのものは絶対にログへ出さない（名前だけ）
    throw new Error(`missing_env:${name}`);
  }
  return value;
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

/**
 * Authorization ヘッダのJWTからログインユーザーを特定する。
 * 統合時の差異（I17）: 旧 agora-token 版は { id } だけを返していた。決済側（stripe-checkout）が
 * email を使うため、{ id, email } を返す _shared/stripe.ts 版に寄せた（id の扱いは同じ）。
 */
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
