import { describe, expect, it } from 'vitest';
import { containsFraudWord, FRAUD_WORDS, findFraudWords } from '../src/fraud_words';

describe('FRAUD_WORDS 辞書', () => {
  it('初期辞書は50語ある（SPEC §4 R8）', () => {
    expect(FRAUD_WORDS.length).toBe(50);
  });

  it('重複がない', () => {
    expect(new Set(FRAUD_WORDS).size).toBe(FRAUD_WORDS.length);
  });

  it('辞書の英字はすべて小文字（正規化後の一致のため）', () => {
    for (const word of FRAUD_WORDS) {
      expect(word).toBe(word.toLowerCase());
    }
  });
});

describe('findFraudWords', () => {
  it('「投資」を含むメッセージを検知する（M3受け入れ条件の語）', () => {
    expect(findFraudWords('いい投資の話があるんです')).toContain('投資');
  });

  it('大文字・全角英数も検知する', () => {
    expect(containsFraudWord('FXで稼ぎませんか')).toBe(true);
    expect(containsFraudWord('ＦＸやってます')).toBe(true);
  });

  it('普通の挨拶は検知しない', () => {
    expect(findFraudWords('はじめまして。よろしくお願いします。')).toEqual([]);
    expect(findFraudWords('週末は子どもと公園に行きました')).toEqual([]);
  });

  it('複数ワードはすべて返す', () => {
    const hits = findFraudWords('仮想通貨の投資で不労所得を得ましょう');
    expect(hits).toEqual(expect.arrayContaining(['仮想通貨', '投資', '不労所得']));
  });
});
