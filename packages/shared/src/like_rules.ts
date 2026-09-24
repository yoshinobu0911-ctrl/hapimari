/**
 * いいね送信の業務検証（SPEC §4 R3 / docs/design/M3_design.md §4.1）
 *
 * Edge Function `like` の判定ロジックを純粋関数として切り出したもの。
 * DBアクセスを伴わない判定（本人確認・active・自分自身・同性・ブロック・R3）をここに集約し、
 * Vitest でテストする。重複いいね（unique制約）と R4 計数は Edge Function 側で行う。
 */

/** 判定に必要な最小限のプロフィール情報 */
export interface LikeRuleUser {
  id: string;
  gender: 'male' | 'female';
  status: string;
  /** 本人確認（児童でないことの確認）が承認済みか（profiles.is_verified） */
  isVerified: boolean;
  hasChildren: boolean;
  understandsChildren: boolean;
}

export type LikeRuleError =
  | 'not_verified'
  | 'not_active'
  | 'self_like'
  | 'target_not_found'
  | 'blocked';

/** エラーコード→HTTPステータス（Edge Function のレスポンスに使用） */
export const LIKE_ERROR_STATUS: Record<LikeRuleError, number> = {
  not_verified: 403,
  not_active: 403,
  self_like: 400,
  target_not_found: 404,
  blocked: 403,
};

/** エラーコード→ユーザー向けメッセージ（すべて日本語・そのまま画面表示できる文言） */
export const LIKE_ERROR_MESSAGES: Record<LikeRuleError, string> = {
  not_verified: '本人確認の完了後にご利用いただけます。お手続きの完了をお待ちください。',
  not_active: 'ただいま、いいねを送信できません。本人確認やアカウント状態をご確認ください。',
  self_like: 'ご自身にいいねは送れません。',
  target_not_found: 'お相手が見つかりませんでした。退会された可能性があります。',
  blocked: 'このお相手にはいいねを送れません。',
};

export type LikeValidationResult =
  | { ok: true }
  | { ok: false; error: LikeRuleError; status: number; message: string };

function fail(error: LikeRuleError): LikeValidationResult {
  return {
    ok: false,
    error,
    status: LIKE_ERROR_STATUS[error],
    message: LIKE_ERROR_MESSAGES[error],
  };
}

/**
 * 送信者だけで決まる判定。Edge Function は相手の取得・ブロック照会より前にこれを呼ぶ。
 * 2026-08-26 オーナー決定: いいね送信は送信者の本人確認の承認後のみ。
 * status はここでは見ない（見ると、確認済みで非activeの送信者への応答順が現行から変わるため）。
 */
export function validateLikeSender(sender: LikeRuleUser): LikeValidationResult {
  if (sender.isVerified !== true) return fail('not_verified');
  return { ok: true };
}

/**
 * いいね送信可否の判定（この順で早期return）。
 * 0. 送信者の本人確認（validateLikeSender）
 * ※ R3（子持ち理解ゲート）は 2026-07-12 オーナー指示で撤廃。
 *   has_children / understands_children は相性スコアの参考値としてのみ使う。
 *
 * @param sender  送信者のプロフィール
 * @param target  相手のプロフィール（取得できなかった場合は null を渡す）
 * @param isBlocked  is_blocked_between(sender, target) の結果
 */
export function validateLike(
  sender: LikeRuleUser,
  target: LikeRuleUser | null,
  isBlocked: boolean,
): LikeValidationResult {
  // 0. 送信者が本人確認済みであること（他のどの拒否理由より先に判定する）
  const senderVerdict = validateLikeSender(sender);
  if (!senderVerdict.ok) return senderVerdict;

  // 1. 送信者が active であること
  if (sender.status !== 'active') return fail('not_active');

  // 2. 自分自身へのいいね禁止
  if (target?.id === sender.id) return fail('self_like');

  // 3. 相手が存在し active かつ異性であること
  if (target?.status !== 'active' || target.gender === sender.gender) {
    return fail('target_not_found');
  }

  // 4. ブロック関係（両方向）があれば拒否
  if (isBlocked) return fail('blocked');

  return { ok: true };
}
