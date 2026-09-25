/**
 * 誹謗中傷・脅迫ワード辞書の互換用の入口（本体は fraud_words.ts）。
 *
 * 2026-09-26: 本体を fraud_words.ts へ移した。Edge Function（Deno）は拡張子なしの相対 import を
 * 解決できず、このファイルが fraud_words を import していたため like 関数が起動しなかった。
 * アプリ・テストからの import 先を変えないために再公開だけを残す。
 * **Edge Function（supabase/functions）からはこのファイルを import しないこと。**
 */
export { ABUSE_WORDS, containsAbuseWord, findAbuseWords } from './fraud_words';
