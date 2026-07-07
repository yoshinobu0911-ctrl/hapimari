import { describe, expect, it } from 'vitest';
import { generateDateSlots, slotLabel } from '../src/date_slots';
import { PREFECTURE_CAPITALS, suggestArea } from '../src/prefecture_capitals';

// 2026-07-07(火) JST 正午を基準にする（対象期間: 7/9(木)〜7/21(火)）
const NOW = new Date('2026-07-07T12:00:00+09:00');

describe('generateDateSlots（R7）', () => {
  it('共通の時間帯があればそれを使い、R7上位固定順（weekday_lunch→weekend_am）で並ぶ', () => {
    const slots = generateDateSlots(
      ['weekday_lunch', 'weekend_am', 'weekday_night'],
      ['weekend_am', 'weekday_lunch'],
      NOW,
    );
    expect(slots.length).toBe(6);
    const times = slots.map((s) => s.time_range);
    // 上位固定: weekday_lunch がすべて weekend_am より前
    const lastLunch = times.lastIndexOf('weekday_lunch');
    const firstWeekendAm = times.indexOf('weekend_am');
    expect(lastLunch).toBeLessThan(firstWeekendAm);
    expect(new Set(times)).toEqual(new Set(['weekday_lunch', 'weekend_am']));
  });

  it('共通の時間帯が無ければ R7 既定（weekday_lunch / weekend_am）にフォールバック', () => {
    const slots = generateDateSlots(['weekday_night'], ['weekend_pm'], NOW);
    expect(slots.length).toBe(6);
    for (const s of slots) {
      expect(['weekday_lunch', 'weekend_am']).toContain(s.time_range);
    }
  });

  it('平日枠は平日・週末枠は土日にだけ割り当たる', () => {
    const slots = generateDateSlots(
      ['weekday_lunch', 'weekend_am', 'weekend_pm', 'weekday_night'],
      ['weekday_lunch', 'weekend_am', 'weekend_pm', 'weekday_night'],
      NOW,
      12,
    );
    for (const s of slots) {
      const dow = new Date(`${s.date}T00:00:00Z`).getUTCDay();
      const weekend = dow === 0 || dow === 6;
      if (s.time_range === 'weekend_am' || s.time_range === 'weekend_pm') {
        expect(weekend).toBe(true);
      } else {
        expect(weekend).toBe(false);
      }
    }
  });

  it('対象期間は明後日〜14日後（直近すぎる日を出さない）', () => {
    const slots = generateDateSlots(['weekday_lunch'], ['weekday_lunch'], NOW, 10);
    for (const s of slots) {
      expect(s.date >= '2026-07-09').toBe(true);
      expect(s.date <= '2026-07-21').toBe(true);
    }
  });

  it('同一時間帯内は日付昇順・ラベルは日本語表記', () => {
    const slots = generateDateSlots(['weekend_am'], ['weekend_am'], NOW, 4);
    const dates = slots.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
    // 2026-07-11 は土曜
    expect(slotLabel('2026-07-11', 'weekend_am')).toBe('7/11(土) 午前');
    expect(slotLabel('2026-07-13', 'weekday_lunch')).toBe('7/13(月) ランチ');
  });
});

describe('suggestArea（県庁所在地ベース）', () => {
  it('47都道府県すべてに県庁所在地がある', () => {
    expect(Object.keys(PREFECTURE_CAPITALS).length).toBe(47);
  });

  it('同一県は「◯◯周辺」', () => {
    expect(suggestArea('東京都', '東京都')).toBe('東京周辺');
  });

  it('異なる県は双方の県庁所在地を併記', () => {
    expect(suggestArea('埼玉県', '千葉県')).toBe('さいたま（大宮）または千葉のあたり');
  });

  it('未知の県名は null', () => {
    expect(suggestArea('東京都', '不明県')).toBeNull();
  });
});
