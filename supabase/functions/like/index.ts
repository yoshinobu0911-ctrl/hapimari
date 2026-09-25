/**
 * いいね送信 Edge Function（docs/design/M3_design.md §4.1）
 *
 * likes への直接INSERTは migration で禁止済み（RLSポリシー削除+GRANT剥奪）。
 * いいねは必ずこの関数を経由し、業務検証と R4（表示繰越判定）を行う。
 * 判定ロジックは packages/shared/src/like_rules.ts（Vitestテスト済み）を共用する。
 * ※ R3（子持ち理解ゲート）は 2026-07-12 オーナー指示で撤廃。
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
import { findAbuseWords, findFraudWords } from '../../../packages/shared/src/fraud_words.ts';
import {
  type LikeRuleUser,
  validateLike,
  validateLikeSender,
} from '../../../packages/shared/src/like_rules.ts';
import { corsHeaders, json } from '../_shared/http.ts';

// 暴力性を示唆するカテゴリ（OpenAI moderations の categories キー）。
// 固定辞書（fraud_words.ts の ABUSE_WORDS）の補完として、辞書に無い言い回しの暴力表現も検知する。
const VIOLENT_MODERATION_CATEGORIES = [
  'violence',
  'violence/graphic',
  'harassment/threatening',
  'hate/threatening',
] as const;

/**
 * 一言メッセージの暴力性をAIで判定する（2026-09-09オーナー指示・固定辞書との多層防御）。
 * MESSAGE_MODERATION_API_KEY 未設定、またはAPI障害時は false を返し、
 * 固定辞書（fraud_words.ts の ABUSE_WORDS）による遮断のみで運用する（フェイルオープン。送信自体は
 * 止めない＝いいね機能全体がAI障害で止まらないようにする）。
 */
async function isMessageViolent(text: string, apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      results?: Array<{ categories?: Record<string, boolean> }>;
    };
    const categories = data.results?.[0]?.categories ?? {};
    return VIOLENT_MODERATION_CATEGORIES.some((c) => categories[c] === true);
  } catch {
    return false;
  }
}

interface ProfileRow {
  id: string;
  gender: string;
  status: string;
  is_verified: boolean;
  has_children: boolean;
  understands_children: boolean;
}

function toRuleUser(p: ProfileRow): LikeRuleUser {
  return {
    id: p.id,
    gender: p.gender as LikeRuleUser['gender'],
    status: p.status,
    isVerified: p.is_verified === true,
    hasChildren: p.has_children,
    understandsChildren: p.understands_children,
  };
}

const PROFILE_COLUMNS = 'id, gender, status, is_verified, has_children, understands_children';

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
  // M6.5 対応7（Leo指摘）: 一言メッセージにも詐欺ワード検査を適用（チャットのflaggedと同じ辞書）。
  // チャットと違い未マッチの相手に届くため、警告表示ではなく送信自体を拒否する。
  const fraudWords = findFraudWords(message);
  if (fraudWords.length > 0) {
    return json(400, {
      ok: false,
      error: 'fraud_message',
      message: `一言メッセージに使用できない表現が含まれています（${fraudWords[0]}）。内容を変えてお試しください。`,
    });
  }

  // 2026-08-27オーナー決定（案A）: 暴言・誹謗中傷は専用辞書で送信自体を拒否する。
  const abuseWords = findAbuseWords(message);
  if (abuseWords.length > 0) {
    return json(400, {
      ok: false,
      error: 'abuse_message',
      message: `一言メッセージに使用できない表現が含まれています（${abuseWords[0]}）。内容を変えてお試しください。`,
    });
  }

  // 固定辞書の補完として、AIでも暴力性を判定する（2026-09-09オーナー指示）。
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Edge Function のシークレット（supabase/functions/.env.example 参照）
  const moderationApiKey = Deno.env.get('MESSAGE_MODERATION_API_KEY');
  if (message && moderationApiKey && (await isMessageViolent(message, moderationApiKey))) {
    return json(400, {
      ok: false,
      error: 'violent_message',
      message:
        '一言メッセージに暴力的な表現が含まれている可能性があるため送信できません。内容を変えてお試しください。',
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

  // 本人確認（児童でないことの確認）が完了するまで、いいねは送れない
  // （一言メッセージが未確認のまま相手に届くのを防ぐ。出会い系サイト規制法の
  //   年齢確認を安全側に倒す 2026-08-26 オーナー決定。
  //   docs/decisions/2026-08-26_確認前操作の安全側変更.md）
  const sender = toRuleUser(senderRow as ProfileRow);
  const senderVerdict = validateLikeSender(sender);
  if (!senderVerdict.ok) {
    return json(senderVerdict.status, {
      ok: false,
      error: senderVerdict.error,
      message: senderVerdict.message,
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
    sender,
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
