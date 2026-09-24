/**
 * 通話トークン発行の判定のうち DB アクセスを伴わない部分（I28）。
 * agora-token/index.ts が import し、packages/shared/test から Vitest で検証する。
 */
export type BlockCheckOutcome = 'clear' | 'blocked' | 'unavailable';

/**
 * is_match_blocked の RPC 結果を解釈する。error を最優先で見る。
 * false を確認できたときだけ clear。error あり・null・boolean 以外はすべて unavailable。
 */
export function interpretBlockCheck(result: { data: unknown; error: unknown }): BlockCheckOutcome {
  if (result.error != null) return 'unavailable';
  if (result.data === false) return 'clear';
  if (result.data === true) return 'blocked';
  return 'unavailable';
}
