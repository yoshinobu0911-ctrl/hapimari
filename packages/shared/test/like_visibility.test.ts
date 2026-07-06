import { describe, expect, it } from 'vitest';
import { FEMALE_DAILY_LIKE_LIMIT } from '../src/constants';
import { assignVisibleDates, toJstDateString } from '../src/like_visibility';

/** JST の日時（時刻は日中）で created_at を作る。seq は同日内の連番（秒加算） */
function jst(date: string, seq = 0): { created_at: string; key: string } {
  const base = new Date(`${date}T09:00:00+09:00`).getTime();
  return {
    created_at: new Date(base + seq * 1000).toISOString(),
    key: `${date}-${seq}`,
  };
}

/** 同じJST日に n 件のいいねを作る */
function likesOn(date: string, n: number): { created_at: string; key: string }[] {
  return Array.from({ length: n }, (_, i) => jst(date, i));
}

const NOW = new Date('2026-07-06T12:00:00+09:00'); // 今日 = 2026-07-06 (JST)

describe('toJstDateString', () => {
  it('UTC深夜はJSTでは翌日になる', () => {
    expect(toJstDateString('2026-07-05T20:00:00Z')).toBe('2026-07-06');
    expect(toJstDateString('2026-07-05T14:59:59Z')).toBe('2026-07-05');
  });
});

describe('assignVisibleDates（R4 表示繰越）', () => {
  it('上限以内なら当日全表示・繰越なし', () => {
    const likes = likesOn('2026-07-06', 100);
    const result = assignVisibleDates(likes, FEMALE_DAILY_LIKE_LIMIT, NOW);
    expect(result.visible.length).toBe(100);
    expect(result.carriedOver.length).toBe(0);
  });

  it('101件目が翌日に繰り越される（上限100の境界）', () => {
    const likes = likesOn('2026-07-06', 101);
    const result = assignVisibleDates(likes, FEMALE_DAILY_LIKE_LIMIT, NOW);
    expect(result.visible.length).toBe(100);
    expect(result.carriedOver.length).toBe(1);
    expect(result.assignments[100]?.displayDate).toBe('2026-07-07');
  });

  it('繰り越された分は翌日になれば表示される', () => {
    const likes = likesOn('2026-07-06', 101);
    const tomorrow = new Date('2026-07-07T00:30:00+09:00');
    const result = assignVisibleDates(likes, FEMALE_DAILY_LIKE_LIMIT, tomorrow);
    expect(result.visible.length).toBe(101);
    expect(result.carriedOver.length).toBe(0);
  });

  it('複数日跨ぎの累積繰越（limit=3で検証）', () => {
    // 7/4に7件 → 7/4:3件 7/5:3件 7/6:1件。7/5にさらに2件 → 7/6の残り枠へ
    const likes = [...likesOn('2026-07-04', 7), ...likesOn('2026-07-05', 2)];
    const result = assignVisibleDates(likes, 3, NOW);
    const dates = result.assignments.map((a) => a.displayDate);
    expect(dates).toEqual([
      '2026-07-04',
      '2026-07-04',
      '2026-07-04',
      '2026-07-05',
      '2026-07-05',
      '2026-07-05',
      '2026-07-06',
      '2026-07-06',
      '2026-07-06',
    ]);
    expect(result.visible.length).toBe(9);
    expect(result.carriedOver.length).toBe(0);
  });

  it('繰越が今日を越えると「明日以降に表示」件数になる（limit=3）', () => {
    const likes = likesOn('2026-07-06', 8);
    const result = assignVisibleDates(likes, 3, NOW);
    expect(result.visible.length).toBe(3);
    expect(result.carriedOver.length).toBe(5);
    // 7/7に3件・7/8に2件
    const carried = result.assignments.slice(3).map((a) => a.displayDate);
    expect(carried).toEqual(['2026-07-07', '2026-07-07', '2026-07-07', '2026-07-08', '2026-07-08']);
  });

  it('男性受信者は無制限（Infinity）で全件当日表示', () => {
    const likes = likesOn('2026-07-06', 500);
    const result = assignVisibleDates(likes, Number.POSITIVE_INFINITY, NOW);
    expect(result.visible.length).toBe(500);
    expect(result.carriedOver.length).toBe(0);
  });

  it('入力順に依存しない（内部で created_at 昇順に整列する）', () => {
    const likes = [...likesOn('2026-07-06', 4)].reverse();
    const result = assignVisibleDates(likes, 3, NOW);
    expect(result.visible.length).toBe(3);
    // 繰り越されるのは最後（最新）のいいね
    const carried = result.carriedOver[0];
    expect(carried?.key).toBe('2026-07-06-3');
  });
});
