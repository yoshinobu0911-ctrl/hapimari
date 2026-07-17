import { describe, expect, it } from 'vitest';
import {
  applyDistanceFilter,
  buildDiscoverConditions,
  countActiveFilters,
  DEFAULT_DISCOVER_FILTER,
  type DiscoverFilter,
  type DiscoverMe,
  formatDistanceLabel,
} from '../src/discover_filters';

const NOW = new Date('2026-07-06T12:00:00+09:00');
const me: DiscoverMe = { gender: 'male', prefecture: '東京都' };

function filter(overrides: Partial<DiscoverFilter> = {}): DiscoverFilter {
  return { ...DEFAULT_DISCOVER_FILTER, ...overrides };
}

describe('buildDiscoverConditions（M6: 距離モードが既定）', () => {
  it('既定フィルタ = 異性・距離30km・県条件なし', () => {
    const c = buildDiscoverConditions(filter(), me, NOW);
    expect(c.gender).toBe('female');
    expect(c.prefectures).toBeNull();
    expect(c.distanceLimitKm).toBe(30);
    expect(c.birthDateOnOrBefore).toBeNull();
    expect(c.maritalHistories).toBeNull();
    expect(c.marriageIntents).toBeNull();
    expect(c.availableTimesOverlaps).toBeNull();
  });

  it('年齢→birth_dateレンジの両端（45歳以上55歳以下）', () => {
    const c = buildDiscoverConditions(filter({ ageMin: 45, ageMax: 55 }), me, NOW);
    expect(c.birthDateOnOrBefore).toBe('1981-07-06');
    expect(c.birthDateAfter).toBe('1970-07-06');
  });

  it('エリア「全国」「県を選ぶ」では距離絞り込みなし', () => {
    const all = buildDiscoverConditions(filter({ area: { mode: 'all' } }), me, NOW);
    expect(all.prefectures).toBeNull();
    expect(all.distanceLimitKm).toBeNull();

    const custom = buildDiscoverConditions(
      filter({ area: { mode: 'custom', prefectures: ['北海道'] } }),
      me,
      NOW,
    );
    expect(custom.prefectures).toEqual(['北海道']);
    expect(custom.distanceLimitKm).toBeNull();
  });

  it('距離モードの上限は変更可能・「制限なし」はnull', () => {
    expect(
      buildDiscoverConditions(filter({ area: { mode: 'distance', limitKm: 100 } }), me, NOW)
        .distanceLimitKm,
    ).toBe(100);
    expect(
      buildDiscoverConditions(filter({ area: { mode: 'distance', limitKm: null } }), me, NOW)
        .distanceLimitKm,
    ).toBeNull();
  });
});

describe('applyDistanceFilter（判断#10: 30km上限+同一県救済）', () => {
  const profiles = [
    { id: 'a', prefecture: '東京都' }, // 5km
    { id: 'b', prefecture: '千葉県' }, // 28km
    { id: 'c', prefecture: '埼玉県' }, // 45km → 30km上限で除外
    { id: 'd', prefecture: '東京都' }, // 距離不明・同県 → 救済で表示
    { id: 'e', prefecture: '千葉県' }, // 距離不明・他県 → 非表示
  ];
  const distances = new Map([
    ['a', 5],
    ['b', 28],
    ['c', 45],
  ]);

  it('30km上限: 圏内+同県救済のみ残る', () => {
    const kept = applyDistanceFilter(profiles, distances, 30, '東京都').map((p) => p.id);
    expect(kept).toEqual(['a', 'b', 'd']);
  });

  it('上限なし(null): 距離持ちは全表示・不明は同県のみ', () => {
    const kept = applyDistanceFilter(profiles, distances, null, '東京都').map((p) => p.id);
    expect(kept).toEqual(['a', 'b', 'c', 'd']);
  });

  it('自分が位置未許可（距離が全員不明）: 同一県のみ表示', () => {
    const kept = applyDistanceFilter(profiles, new Map(), 30, '東京都').map((p) => p.id);
    expect(kept).toEqual(['a', 'd']);
  });
});

describe('formatDistanceLabel（プライバシー配慮の丸め）', () => {
  it('5km未満は「5km以内」・30kmまで5km刻み・100kmまで10km刻み・以遠は100km以上', () => {
    expect(formatDistanceLabel(0)).toBe('5km以内');
    expect(formatDistanceLabel(4)).toBe('5km以内');
    expect(formatDistanceLabel(6)).toBe('約5km');
    expect(formatDistanceLabel(13)).toBe('約15km');
    expect(formatDistanceLabel(28)).toBe('約30km');
    expect(formatDistanceLabel(47)).toBe('約50km');
    expect(formatDistanceLabel(101)).toBe('100km以上');
  });
});

describe('countActiveFilters', () => {
  it('既定（距離30km・相性順）は0', () => {
    expect(countActiveFilters(DEFAULT_DISCOVER_FILTER)).toBe(0);
  });

  it('距離上限の変更・全国・年齢はカウントされる', () => {
    expect(countActiveFilters(filter({ area: { mode: 'distance', limitKm: 10 } }))).toBe(1);
    expect(countActiveFilters(filter({ area: { mode: 'all' } }))).toBe(1);
    expect(countActiveFilters(filter({ ageMin: 45, area: { mode: 'all' } }))).toBe(2);
  });

  it('並び替えの変更はフィルタ数に数えない', () => {
    expect(countActiveFilters(filter({ sort: 'distance' }))).toBe(0);
  });
});
