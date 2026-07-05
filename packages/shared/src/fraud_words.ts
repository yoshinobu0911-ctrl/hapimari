/**
 * 詐欺ワード辞書（SPEC §4 R8）
 *
 * メッセージ本文に金銭・投資・外部誘導ワードが含まれる場合に
 * flagged=true とし、受信者に注意バナーを表示するための初期辞書50語。
 *
 * 判定は正規化（小文字化・全角英数→半角）後の部分一致。
 * 辞書の追加・削除はこのファイルのみを変更すればよい。
 */

export const FRAUD_WORDS: readonly string[] = [
  // --- 投資・儲け話（ロマンス詐欺の典型導入） ---
  '投資',
  '資産運用',
  '仮想通貨',
  '暗号資産',
  'ビットコイン',
  'fx',
  'バイナリーオプション',
  '先物取引',
  '元本保証',
  '必ず儲かる',
  '絶対儲かる',
  '儲かる話',
  '不労所得',
  '権利収入',
  '利回り',
  '配当金',
  '月収100万',
  '副業',
  '稼げる',
  '簡単に稼ぐ',
  '情報商材',
  'セミナーに来',
  'マルチ商法',
  'ネットワークビジネス',
  'ねずみ講',
  '代理店募集',

  // --- 金銭要求・送金 ---
  '振り込んで',
  '振込先',
  '送金',
  '口座番号',
  '銀行口座を教えて',
  '電子マネー',
  'プリペイドカード',
  'ギフトカード',
  'ギフト券',
  'アマギフ',
  '現金プレゼント',
  'お金を貸して',
  'お金に困って',
  '借金の返済',
  '融資',
  '立て替えて',

  // --- 外部誘導（サイト外へ連れ出す動線） ---
  '別のサイト',
  '他のサイト',
  'こちらのurl',
  'このリンクに登録',
  'qrコードを読み',
  '直アド',
  'メアド交換',
  '退会するので連絡先',
] as const;

/** 判定用に文字列を正規化する（小文字化 + 全角英数字→半角） */
export function normalizeForFraudCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 本文に含まれる詐欺ワードを返す。空配列なら検知なし。
 * Edge Function（メッセージ送信時）とクライアント（注意バナー表示）で共用する。
 */
export function findFraudWords(body: string): string[] {
  const normalized = normalizeForFraudCheck(body);
  return FRAUD_WORDS.filter((word) => normalized.includes(word));
}

export function containsFraudWord(body: string): boolean {
  return findFraudWords(body).length > 0;
}
