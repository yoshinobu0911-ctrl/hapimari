import { describe, expect, it } from 'vitest';
import {
  COMPATIBILITY_DISPLAY_MIN,
  type CompatibilityInput,
  calcCompatibility,
  shouldShowCompatibility,
} from '../src/compatibility';
import { VALUE_TAG_LABELS, VALUE_TAGS, valueTagsByCategory } from '../src/value_tags';

const base: CompatibilityInput = {
  valueTags: ['comm_lunch', 'hobby_travel', 'char_calm'],
  availableTimes: ['weekday_lunch', 'weekend_am'],
  marriageIntent: 'within_2y',
  maritalHistory: 'divorced',
  hasChildren: true,
  understandsChildren: true,
  understandsRemarriage: true,
};

describe('VALUE_TAGS', () => {
  it('30タグ・重複なし・全カテゴリに紐づく', () => {
    expect(VALUE_TAGS.length).toBe(30);
    expect(new Set(VALUE_TAGS.map((t) => t.id)).size).toBe(30);
    for (const group of valueTagsByCategory()) {
      expect(group.tags.length).toBeGreaterThan(0);
    }
    expect(VALUE_TAG_LABELS.comm_lunch).toBe('まずはランチから');
  });
});

describe('calcCompatibility', () => {
  it('40〜98の範囲に収まる', () => {
    const best = calcCompatibility(base, { ...base });
    const worst = calcCompatibility(
      {
        ...base,
        valueTags: ['a'],
        availableTimes: ['weekday_night'],
        marriageIntent: 'asap',
        understandsChildren: false,
        understandsRemarriage: false,
      },
      { ...base, valueTags: ['b'], availableTimes: ['weekend_pm'], marriageIntent: 'partner_only' },
    );
    expect(best).toBe(98);
    expect(worst).toBeGreaterThanOrEqual(40);
    expect(worst).toBeLessThan(60);
  });

  it('タグが多く一致するほど高い', () => {
    const noShare = calcCompatibility(base, { ...base, valueTags: ['money_dual'] });
    const oneShare = calcCompatibility(base, { ...base, valueTags: ['comm_lunch'] });
    const allShare = calcCompatibility(base, { ...base, valueTags: [...base.valueTags] });
    expect(oneShare).toBeGreaterThan(noShare);
    expect(allShare).toBeGreaterThan(oneShare);
  });

  it('タグ未設定の相手は中立値で計算される（表示不能にならない）', () => {
    const score = calcCompatibility(base, { ...base, valueTags: [] });
    expect(score).toBeGreaterThanOrEqual(40);
    expect(score).toBeLessThanOrEqual(98);
  });

  it('子持ちの相手に理解宣言がないと下がる', () => {
    const withUnderstanding = calcCompatibility(base, { ...base });
    const without = calcCompatibility({ ...base, understandsChildren: false }, { ...base });
    expect(without).toBeLessThan(withUnderstanding);
  });

  it('結婚意向が近いほど高い', () => {
    const same = calcCompatibility(base, { ...base, marriageIntent: 'within_2y' });
    const adjacent = calcCompatibility(base, { ...base, marriageIntent: 'someday' });
    const far = calcCompatibility(base, { ...base, marriageIntent: 'partner_only' });
    expect(same).toBeGreaterThan(adjacent);
    expect(adjacent).toBeGreaterThan(far);
  });
});

describe('shouldShowCompatibility（相性は85%以上のみ表示）', () => {
  it('85%以上でtrue、85%未満でfalse', () => {
    expect(COMPATIBILITY_DISPLAY_MIN).toBe(85);
    expect(shouldShowCompatibility(85)).toBe(true);
    expect(shouldShowCompatibility(98)).toBe(true);
    expect(shouldShowCompatibility(84)).toBe(false);
    expect(shouldShowCompatibility(40)).toBe(false);
  });
});
