import { describe, expect, it } from 'vitest';
import { ABUSE_WORDS, containsAbuseWord, findAbuseWords } from '../src/abuse_words';

describe('ABUSE_WORDS 辞書', () => {
  it('重複がない', () => {
    expect(new Set(ABUSE_WORDS).size).toBe(ABUSE_WORDS.length);
  });
});

describe('findAbuseWords', () => {
  it('生命への脅迫を検知する（2026-09-09オーナー指示の必須例）', () => {
    expect(containsAbuseWord('殺すぞ')).toBe(true);
    expect(containsAbuseWord('死ね')).toBe(true);
  });

  it('容姿への侮辱を検知する', () => {
    expect(findAbuseWords('お前ブスだな')).toContain('ブス');
  });

  it('普通の挨拶は検知しない', () => {
    expect(findAbuseWords('はじめまして。よろしくお願いします。')).toEqual([]);
    expect(findAbuseWords('お会いできて嬉しいです')).toEqual([]);
  });

  it('複数ワードはすべて返す', () => {
    const hits = findAbuseWords('ブスのくせに底辺のくせに');
    expect(hits).toEqual(expect.arrayContaining(['ブス', '底辺']));
  });
});
