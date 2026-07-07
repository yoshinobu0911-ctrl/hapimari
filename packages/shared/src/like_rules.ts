/**
 * いいね送信の業務検証（SPEC §4 R3 / docs/design/M3_design.md §4.1）
 *
 * Edge Function `like` の判定ロジックを純粋関数として切り出したもの。
 * DBアクセスを伴わない判定（active・自分自身・同性・ブロック・R3）をここに集約し、
 * Vitest でテストする。重複いいね（unique制約）と R4 計数は Edge Function 側で行う。
 */

/** 判定に必要な最小限のプロフィール情報 */
export interface LikeRuleUser {
  id: string;
  gender: 'male' | 'female';
  status: string;
  hasChildren: boolean;
  understandsChildren: boolean;
}

export type LikeRuleError =
  | 'not_active'
  | 'self_like'
  | 'target_not_found'
  | 'blocked'
  | 'understands_children_required';

/** エラーコード→HTTPステータス（Edge Function のレスポンスに使用） */
export const LIKE_ERROR_STATUS: Record<LikeRuleError, number> = {
  not_active: 403,
  self_like: 400,
  target_not_found: 404,
  blocked: 403,
  understands_children_required: 403,
};

/** エラーコード→ユーザー向けメッセージ（すべて日本語・そのまま画面表示できる文言） */
export const LIKE_ERROR_MESSAGES: Record<LikeRuleError, string> = {
  not_active: 'ただいま、いいねを送信できません。本人確認やアカウント状態をご確認ください。',
  self_like: 'ご自身にいいねは送れません。',
  target_not_found: 'お相手が見つかりませんでした。退会された可能性があります。',
  blocked: 'このお相手にはいいねを送れません。',
  understands_children_required:
    'お子さまのいるお相手へは、プロフィールで『お子さまのいるお相手を理解し、尊重します』を選択した方のみいいねを送れます',
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
 * いいね送信可否の判定（§4.1 の検証 1〜5。この順で早期return）。
 *
 * @param sender  送信者のプロフィール
 * @param target  相手のプロフィール（取得できなかった場合は null を渡す）
 * @param isBlocked  is_blocked_between(sender, target) の結果
 * @param targetInitiated  相手が先に自分へいいねを送っている場合 true。
 *   M6（案A・2026-07-07）: 子持ち女性が自ら選んで男性にいいねした場合、
 *   その「いいね返し」はR3ゲートを通す（保護の趣旨＝望まないアプローチの防止に反しないため。
 *   これを塞ぐと、非表示のはずの子ども情報がエラー文言から漏れてしまう）
 */
export function validateLike(
  sender: LikeRuleUser,
  target: LikeRuleUser | null,
  isBlocked: boolean,
  targetInitiated = false,
): LikeValidationResult {
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

  // 5. R3: 子持ち女性へは understands_children=true の男性のみ
  //    （相手が先にいいねをくれている場合は適用しない＝いいね返しは常に可能）
  if (
    !targetInitiated &&
    target.gender === 'female' &&
    target.hasChildren &&
    sender.gender === 'male' &&
    !sender.understandsChildren
  ) {
    return fail('understands_children_required');
  }

  return { ok: true };
}
