import { describe, expect, it } from 'vitest';
import {
  type CompatibilityInput,
  calcCompatibility,
  compatibilityReasons,
  distanceScore,
} from '../src/compatibility';
import { VALUE_TAG_LABELS } from '../src/value_tags';

const base: CompatibilityInput = {
  valueTags: ['comm_lunch', 'hobby_travel', 'char_calm'],
  availableTimes: ['weekday_lunch', 'weekend_am'],
  marriageIntent: 'within_2y',
};

describe('distanceScore（M6 B6 ランク表）', () => {
  it('近いほど高い（5km=1.0 / 10km=0.9 / 20km=0.7 / 30km=0.5 / 50km=0.3 / 以遠=0.15）', () => {
    expect(distanceScore(3)).toBe(1.0);
    expect(distanceScore(5)).toBe(1.0);
    expect(distanceScore(10)).toBe(0.9);
    expect(distanceScore(20)).toBe(0.7);
    expect(distanceScore(30)).toBe(0.5);
    expect(distanceScore(50)).toBe(0.3);
    expect(distanceScore(51)).toBe(0.15);
  });
});

describe('calcCompatibility（M6: 距離込み）', () => {
  it('同条件なら近いほうがスコアが高い', () => {
    const near = calcCompatibility(base, { ...base }, 3);
    const far = calcCompatibility(base, { ...base }, 29);
    const veryFar = calcCompatibility(base, { ...base }, 80);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(veryFar);
  });

  it('距離不明は再正規化され、減点扱いにならない（他の価値観を優先・オーナー指示）', () => {
    const unknown = calcCompatibility(base, { ...base }, null);
    const perfect = calcCompatibility(base, { ...base }, 3);
    // 他が満点なら、距離不明でも満点近く（距離3km時と同等）になる
    expect(unknown).toBe(perfect);
    // 従来のシグネチャ（距離省略）も同じ挙動
    expect(calcCompatibility(base, { ...base })).toBe(unknown);
  });

  it('40〜98の範囲に収まる（距離込みでも上限を超えない）', () => {
    expect(calcCompatibility(base, { ...base }, 1)).toBeLessThanOrEqual(98);
    const worst = calcCompatibility(
      { ...base, valueTags: ['a'], availableTimes: ['weekday_night'], marriageIntent: 'asap' },
      { ...base, valueTags: ['b'], availableTimes: ['weekend_pm'], marriageIntent: 'partner_only' },
      200,
    );
    expect(worst).toBeGreaterThanOrEqual(40);
  });
});

describe('compatibilityReasons（B4: 共通点の言語化）', () => {
  it('共通タグ・時間帯・結婚観を日本語の理由にする（最大4件）', () => {
    const reasons = compatibilityReasons(base, { ...base }, VALUE_TAG_LABELS, {
      weekday_lunch: '平日ランチ',
    });
    expect(reasons.length).toBeLessThanOrEqual(4);
    expect(reasons[0]).toBe('お二人とも「まずはランチから」派');
    expect(reasons).toContain('会える時間帯が合います（平日ランチ）');
    expect(reasons).toContain('結婚への考えが同じです');
  });

  it('共通点がなければ空配列', () => {
    const other: CompatibilityInput = {
      ...base,
      valueTags: ['money_dual'],
      availableTimes: ['weekday_night'],
      marriageIntent: 'partner_only',
    };
    expect(compatibilityReasons(base, other, VALUE_TAG_LABELS)).toEqual([]);
  });
});

// 旧 SUBSCRIPTION_PLANS（モック課金）の検証は M7.2 で削除した。
// 正式なプラン定義（PAID_PLANS）の検証は subscription-view.test.ts にある。
