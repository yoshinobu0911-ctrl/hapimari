import { describe, expect, it } from 'vitest';
import { searchArea } from '../src/adjacent_prefectures';
import {
  buildDiscoverConditions,
  countActiveFilters,
  DEFAULT_DISCOVER_FILTER,
  type DiscoverFilter,
} from '../src/discover_filters';

const NOW = new Date('2026-07-06T12:00:00+09:00');
const me = { gender: 'male' as const, prefecture: '東京都' };

function filter(overrides: Partial<DiscoverFilter> = {}): DiscoverFilter {
  return { ...DEFAULT_DISCOVER_FILTER, ...overrides };
}

describe('buildDiscoverConditions', () => {
  it('既定フィルタ = 異性・R10エリア（自県+隣接県）のみ', () => {
    const c = buildDiscoverConditions(filter(), me, NOW);
    expect(c.gender).toBe('female');
    expect(c.prefectures).toEqual(searchArea('東京都'));
    expect(c.prefectures).toContain('東京都');
    expect(c.prefectures).toContain('埼玉県');
    expect(c.birthDateOnOrBefore).toBeNull();
    expect(c.birthDateAfter).toBeNull();
    expect(c.maritalHistories).toBeNull();
    expect(c.hasChildren).toBeNull();
    expect(c.marriageIntents).toBeNull();
    expect(c.availableTimesOverlaps).toBeNull();
  });

  it('女性から見ると対象は男性', () => {
    const c = buildDiscoverConditions(filter(), { gender: 'female', prefecture: '千葉県' }, NOW);
    expect(c.gender).toBe('male');
  });

  it('年齢→birth_dateレンジの両端（45歳以上55歳以下）', () => {
    const c = buildDiscoverConditions(filter({ ageMin: 45, ageMax: 55 }), me, NOW);
    // 45歳以上 = 1981-07-06以前生まれ（今日45歳の誕生日を迎えた人を含む）
    expect(c.birthDateOnOrBefore).toBe('1981-07-06');
    // 55歳以下 = age < 56 = 1970-07-06 より後に生まれた
    expect(c.birthDateAfter).toBe('1970-07-06');
  });

  it('エリア「全国」は都道府県条件なし', () => {
    const c = buildDiscoverConditions(filter({ area: { mode: 'all' } }), me, NOW);
    expect(c.prefectures).toBeNull();
  });

  it('エリア「県を選ぶ」は選択県のみ・0件選択は全国扱い', () => {
    const custom = buildDiscoverConditions(
      filter({ area: { mode: 'custom', prefectures: ['北海道', '沖縄県'] } }),
      me,
      NOW,
    );
    expect(custom.prefectures).toEqual(['北海道', '沖縄県']);

    const empty = buildDiscoverConditions(
      filter({ area: { mode: 'custom', prefectures: [] } }),
      me,
      NOW,
    );
    expect(empty.prefectures).toBeNull();
  });

  it('結婚歴: 全選択・未選択は条件なし、一部選択のみ条件になる', () => {
    expect(
      buildDiscoverConditions(filter({ maritalHistories: [] }), me, NOW).maritalHistories,
    ).toBeNull();
    expect(
      buildDiscoverConditions(
        filter({ maritalHistories: ['unmarried', 'divorced', 'widowed'] }),
        me,
        NOW,
      ).maritalHistories,
    ).toBeNull();
    expect(
      buildDiscoverConditions(filter({ maritalHistories: ['divorced'] }), me, NOW).maritalHistories,
    ).toEqual(['divorced']);
  });

  it('子どもの有無: any=条件なし / has=true / none=false', () => {
    expect(buildDiscoverConditions(filter({ children: 'any' }), me, NOW).hasChildren).toBeNull();
    expect(buildDiscoverConditions(filter({ children: 'has' }), me, NOW).hasChildren).toBe(true);
    expect(buildDiscoverConditions(filter({ children: 'none' }), me, NOW).hasChildren).toBe(false);
  });

  it('会える時間帯は overlaps 条件（1つでも重なればヒット）として返す', () => {
    const c = buildDiscoverConditions(
      filter({ availableTimes: ['weekday_lunch', 'weekend_am'] }),
      me,
      NOW,
    );
    expect(c.availableTimesOverlaps).toEqual(['weekday_lunch', 'weekend_am']);
  });
});

describe('countActiveFilters（絞り込み中(n)バッジ）', () => {
  it('既定は0', () => {
    expect(countActiveFilters(DEFAULT_DISCOVER_FILTER)).toBe(0);
  });

  it('年齢・エリア・時間帯を設定すると3', () => {
    const f = filter({
      ageMin: 45,
      area: { mode: 'all' },
      availableTimes: ['weekend_am'],
    });
    expect(countActiveFilters(f)).toBe(3);
  });

  it('結婚歴の全選択はカウントしない', () => {
    expect(
      countActiveFilters(filter({ maritalHistories: ['unmarried', 'divorced', 'widowed'] })),
    ).toBe(0);
    expect(countActiveFilters(filter({ maritalHistories: ['widowed'] }))).toBe(1);
  });
});
