/**
 * いいね送信（Edge Function `like` の呼び出しラッパ）
 *
 * likes への直接INSERTはDB側で禁止されているため、必ずこの関数を使う。
 * エラー時も { ok: false, message } を返し、呼び出し側はそのまま画面表示できる。
 */
import { supabase } from '@/lib/supabase';

export interface LikeSuccess {
  ok: true;
  matched: boolean;
  matchId?: string;
  carriedOver: boolean;
}

export interface LikeFailure {
  ok: false;
  error: string;
  message: string;
}

export type LikeResult = LikeSuccess | LikeFailure;

export async function sendLike(toUser: string, message?: string): Promise<LikeResult> {
  const { data, error } = await supabase.functions.invoke('like', {
    body: { toUser, ...(message ? { message } : {}) },
  });

  if (error) {
    // FunctionsHttpError: 4xx/5xx のボディに { ok:false, error, message } が入っている
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = (await ctx.json()) as Partial<LikeFailure>;
        if (typeof body.message === 'string') {
          return { ok: false, error: body.error ?? 'unknown', message: body.message };
        }
      } catch {
        // JSONでないレスポンスは下のフォールバックへ
      }
    }
    return {
      ok: false,
      error: 'network',
      message: '通信に失敗しました。時間をおいてお試しください。',
    };
  }

  return data as LikeSuccess;
}
