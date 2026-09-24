/**
 * 誹謗中傷・脅迫ワード辞書（2026-08-27オーナー決定 案A / docs/design/abuse_word_filter_proposal.md）
 *
 * いいねの一言メッセージに含まれる暴言・脅迫・侮辱を検知する。
 * fraud_words.ts（詐欺・勧誘語）とは別枠の辞書。fraud_words.ts と同じ正規化方式
 * （小文字化・全角英数→半角。normalizeForFraudCheck を共用）で部分一致判定する。
 */
import { normalizeForFraudCheck } from './fraud_words';

export const ABUSE_WORDS: readonly string[] = [
  // --- 生命・身体への脅迫（最優先で遮断） ---
  '殺すぞ',
  '殺してやる',
  'ぶっ殺す',
  '殺す',
  '死ね',
  '死んでしまえ',
  '死んどけ',
  '消えろ',
  '殴るぞ',
  '刺すぞ',
  '危害を加える',

  // --- 容姿・年齢への侮辱 ---
  'ブス',
  'ブサイク',
  'デブ',
  'キモい',
  'きもい',
  '気持ち悪い',

  // --- 婚歴・家庭状況への蔑視 ---
  'バツイチのくせに',
  '底辺',
  '負け組',

  // --- 性的な強要 ---
  'やらせろ',
  '体目当て',

  // --- 存在否定 ---
  '生きてる価値がない',
  '生きる価値がない',
] as const;

/** 本文に含まれる暴言・脅迫ワードを返す。空配列なら検知なし。 */
export function findAbuseWords(body: string): string[] {
  const normalized = normalizeForFraudCheck(body);
  return ABUSE_WORDS.filter((word) => normalized.includes(word));
}

export function containsAbuseWord(body: string): boolean {
  return findAbuseWords(body).length > 0;
}
