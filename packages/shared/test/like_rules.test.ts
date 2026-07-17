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

const male = user({ id: 'm1', gender: 'male' });
const female = user({ id: 'f1', gender: 'female' });
const femaleWithChildren = user({ id: 'f2', gender: 'female', hasChildren: true });

describe('validateLike', () => {
  it('通常のいいねはOK（子持ち・宣言の有無は問わない。R3は2026-07-12撤廃）', () => {
    expect(validateLike(male, female, false).ok).toBe(true);
    // 宣言なし男性 → 子持ち女性 も送れる（ゲート撤廃）
    expect(validateLike(male, femaleWithChildren, false).ok).toBe(true);
    // 女性 → 男性 も当然OK
    expect(validateLike(female, male, false).ok).toBe(true);
  });

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
    const result = validateLike(male, female, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('blocked');
  });

  it('同性へのいいねは target_not_found', () => {
    const result = validateLike(male, user({ id: 'm9', gender: 'male' }), false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('target_not_found');
  });

  it('相手が見つからない/非activeは target_not_found（404）', () => {
    const missing = validateLike(male, null, false);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(404);

    const suspended = validateLike(
      male,
      user({ id: 'f9', gender: 'female', status: 'suspended' }),
      false,
    );
    expect(suspended.ok).toBe(false);
    if (!suspended.ok) expect(suspended.error).toBe('target_not_found');
  });

  it('送信者が非activeは not_active（403）', () => {
    const result = validateLike(user({ status: 'suspended' }), female, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('not_active');
      expect(result.status).toBe(403);
    }
  });
});
