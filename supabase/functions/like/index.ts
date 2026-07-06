/**
 * いいね送信 Edge Function（docs/design/M3_design.md §4.1）
 *
 * likes への直接INSERTは migration で禁止済み（RLSポリシー削除+GRANT剥奪）。
 * いいねは必ずこの関数を経由し、R3（子持ち理解宣言ゲート）と R4（表示繰越判定）を検証する。
 * 判定ロジックは packages/shared/src/like_rules.ts（Vitestテスト済み）を共用する。
 *
 * 入力:  { toUser: string, message?: string }（message は200字以内・任意）
 * 成功:  { ok: true, matched: boolean, matchId?: string, carriedOver: boolean }
 * 失敗:  { ok: false, error: string, message: string }（statusは LIKE_ERROR_STATUS 準拠）
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  FEMALE_DAILY_LIKE_LIMIT,
  LIKE_MESSAGE_MAX_LENGTH,
} from '../../../packages/shared/src/constants.ts';
import { type LikeRuleUser, validateLike } from '../../../packages/shared/src/like_rules.ts';

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

interface ProfileRow {
  id: string;
  gender: string;
  status: string;
  has_children: boolean;
  understands_children: boolean;
}

function toRuleUser(p: ProfileRow): LikeRuleUser {
  return {
    id: p.id,
    gender: p.gender as LikeRuleUser['gender'],
    status: p.status,
    hasChildren: p.has_children,
    understandsChildren: p.understands_children,
  };
}

const PROFILE_COLUMNS = 'id, gender, status, has_children, understands_children';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json(405, {
      ok: false,
      error: 'method_not_allowed',
      message: 'POSTのみ対応しています。',
    });
  }

  // これらの環境変数は Supabase Edge Runtime が自動注入する（.envには書かない）
  const admin = createClient(
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: Edge Runtimeが注入
    Deno.env.get('SUPABASE_URL') ?? '',
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: Edge Runtimeが注入
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // JWT から送信者を特定（verify_jwt 有効のため Authorization ヘッダは必ずある）
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);
  if (authError || !user) {
    return json(401, { ok: false, error: 'unauthorized', message: 'ログインし直してください。' });
  }

  let body: { toUser?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'invalid_body', message: 'リクエストが不正です。' });
  }
  const toUser = typeof body.toUser === 'string' ? body.toUser : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!toUser) {
    return json(400, { ok: false, error: 'invalid_body', message: 'お相手が指定されていません。' });
  }
  if (message.length > LIKE_MESSAGE_MAX_LENGTH) {
    return json(400, {
      ok: false,
      error: 'message_too_long',
      message: `一言メッセージは${LIKE_MESSAGE_MAX_LENGTH}文字以内で入力してください。`,
    });
  }

  // 1〜5. 送信者・相手・ブロック関係を取得して純粋関数で検証
  const { data: senderRow } = await admin
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();
  if (!senderRow) {
    return json(403, {
      ok: false,
      error: 'not_active',
      message: 'プロフィール登録を完了してください。',
    });
  }

  const { data: targetRow } = await admin
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', toUser)
    .maybeSingle();

  const { data: blocked, error: blockedError } = await admin.rpc('is_blocked_between', {
    a: user.id,
    b: toUser,
  });
  if (blockedError) {
    return json(500, {
      ok: false,
      error: 'internal',
      message: 'エラーが発生しました。時間をおいてお試しください。',
    });
  }

  const verdict = validateLike(
    toRuleUser(senderRow as ProfileRow),
    targetRow ? toRuleUser(targetRow as ProfileRow) : null,
    blocked === true,
  );
  if (!verdict.ok) {
    return json(verdict.status, { ok: false, error: verdict.error, message: verdict.message });
  }

  // 6. 重複いいね（unique制約でも守られるが事前チェックで明示エラー）
  const { data: existing } = await admin
    .from('likes')
    .select('id')
    .eq('from_user', user.id)
    .eq('to_user', toUser)
    .maybeSingle();
  if (existing) {
    return json(409, {
      ok: false,
      error: 'already_liked',
      message: 'このお相手にはすでにいいねを送っています。',
    });
  }

  // 7. INSERT（相互いいねなら DBトリガ trg_likes_mutual_match がマッチを作成する）
  const { error: insertError } = await admin.from('likes').insert({
    from_user: user.id,
    to_user: toUser,
    message: message.length > 0 ? message : null,
  });
  if (insertError) {
    // unique制約違反（同時実行時）は already_liked として返す
    if (insertError.code === '23505') {
      return json(409, {
        ok: false,
        error: 'already_liked',
        message: 'このお相手にはすでにいいねを送っています。',
      });
    }
    return json(500, {
      ok: false,
      error: 'internal',
      message: 'エラーが発生しました。時間をおいてお試しください。',
    });
  }

  // 8. R4: 相手が女性なら直近24hの被いいね数を数え、上限超過なら carriedOver（拒否はしない）
  let carriedOver = false;
  if ((targetRow as ProfileRow).gender === 'female') {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from('likes')
      .select('id', { count: 'exact', head: true })
      .eq('to_user', toUser)
      .gte('created_at', since);
    carriedOver = (count ?? 0) > FEMALE_DAILY_LIKE_LIMIT;
  }

  // 9. マッチ成立確認（user_a = least, user_b = greatest の正規化規約）
  const [a, b] = [user.id, toUser].sort();
  const { data: match } = await admin
    .from('matches')
    .select('id')
    .eq('user_a', a)
    .eq('user_b', b)
    .maybeSingle();

  return json(200, {
    ok: true,
    matched: !!match,
    matchId: match?.id,
    carriedOver,
  });
});
