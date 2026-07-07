import { describe, expect, it } from 'vitest';
import { type LikeRuleUser, validateLike } from '../src/like_rules';

function user(overrides: Partial<LikeRuleUser> = {}): LikeRuleUser {
  return {
    id: 'user-1',
    gender: 'male',
    status: 'active',
    hasChildren: false,
    understandsChildren: false,
    ...overrides,
  };
}

const maleNoDecl = user({ id: 'm1', gender: 'male', understandsChildren: false });
const maleWithDecl = user({ id: 'm2', gender: 'male', understandsChildren: true });
const femaleWithChildren = user({ id: 'f1', gender: 'female', hasChildren: true });
const femaleNoChildren = user({ id: 'f2', gender: 'female', hasChildren: false });

describe('validateLike: R3の4象限', () => {
  it('子持ち女性 × 理解宣言なし男性 = NG（understands_children_required）', () => {
    const result = validateLike(maleNoDecl, femaleWithChildren, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('understands_children_required');
      expect(result.status).toBe(403);
      expect(result.message).toContain('お子さまのいるお相手');
    }
  });

  it('子持ち女性 × 理解宣言あり男性 = OK', () => {
    expect(validateLike(maleWithDecl, femaleWithChildren, false).ok).toBe(true);
  });

  it('子なし女性 × 理解宣言なし男性 = OK', () => {
    expect(validateLike(maleNoDecl, femaleNoChildren, false).ok).toBe(true);
  });

  it('いいね返しはR3を適用しない（子持ち女性が先にいいねした宣言なし男性からの返し・M6案A）', () => {
    const blocked = validateLike(maleNoDecl, femaleWithChildren, false, false);
    expect(blocked.ok).toBe(false);
    const likeBack = validateLike(maleNoDecl, femaleWithChildren, false, true);
    expect(likeBack.ok).toBe(true);
  });

  it('女性→男性は宣言に関係なく OK（子持ち女性が送る側でも制限しない）', () => {
    const femaleSender = user({ id: 'f3', gender: 'female', hasChildren: true });
    const maleTarget = user({ id: 'm3', gender: 'male', hasChildren: true });
    expect(validateLike(femaleSender, maleTarget, false).ok).toBe(true);
  });
});

describe('validateLike: R3以外の拒否条件', () => {
  it('自分自身へのいいねは self_like（400）', () => {
    const me = user({ id: 'same' });
    const result = validateLike(me, user({ id: 'same', gender: 'female' }), false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('self_like');
      expect(result.status).toBe(400);
    }
  });

  it('ブロック関係があると blocked（403）', () => {
    const result = validateLike(maleWithDecl, femaleNoChildren, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('blocked');
  });

  it('同性へのいいねは target_not_found', () => {
    const result = validateLike(maleNoDecl, user({ id: 'm9', gender: 'male' }), false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('target_not_found');
  });

  it('相手が見つからない/非activeは target_not_found（404）', () => {
    const missing = validateLike(maleNoDecl, null, false);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(404);

    const suspended = validateLike(
      maleNoDecl,
      user({ id: 'f9', gender: 'female', status: 'suspended' }),
      false,
    );
    expect(suspended.ok).toBe(false);
    if (!suspended.ok) expect(suspended.error).toBe('target_not_found');
  });

  it('送信者が非activeは not_active（403）', () => {
    const result = validateLike(user({ status: 'suspended' }), femaleNoChildren, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('not_active');
      expect(result.status).toBe(403);
    }
  });
});
