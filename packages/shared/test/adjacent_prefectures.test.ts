import { describe, expect, it } from 'vitest';
import { ADJACENT_PREFECTURES, PREFECTURES, searchArea } from '../src/adjacent_prefectures';

describe('ADJACENT_PREFECTURES', () => {
  it('47都道府県すべてにエントリがある', () => {
    expect(PREFECTURES.length).toBe(47);
    expect(Object.keys(ADJACENT_PREFECTURES).length).toBe(47);
  });

  it('隣接関係は対称である（AがBに隣接ならBもAに隣接）', () => {
    for (const pref of PREFECTURES) {
      for (const neighbor of ADJACENT_PREFECTURES[pref]) {
        expect(ADJACENT_PREFECTURES[neighbor]).toContain(pref);
      }
    }
  });

  it('自分自身を隣接に含まない', () => {
    for (const pref of PREFECTURES) {
      expect(ADJACENT_PREFECTURES[pref]).not.toContain(pref);
    }
  });

  it('沖縄県は隣接なし', () => {
    expect(ADJACENT_PREFECTURES.沖縄県).toEqual([]);
  });

  it('searchArea は居住県＋隣接県を返す（R10: 東京都→千葉・埼玉・神奈川・山梨）', () => {
    const area = searchArea('東京都');
    expect(area).toContain('東京都');
    expect(area).toContain('千葉県');
    expect(area).toContain('埼玉県');
    expect(area).toContain('神奈川県');
    expect(area).toContain('山梨県');
    expect(area.length).toBe(5);
  });
});
