/**
 * 相性スコア（discoverカードの「相性 XX%」）
 *
 * ユーザーがオンボーディングで選んだ価値観タグを最重視し（50%）、
 * 距離・会える時間帯・結婚意向を加味して 0〜100 で返す。
 * 判定はクライアント側の純粋関数（M3の検索・並び替えでも再利用する）。
 */

export interface CompatibilityInput {
  valueTags: readonly string[];
  availableTimes: readonly string[];
  marriageIntent: string | null;
}

/**
 * M6改訂: 距離を導入（2026-07-07 オーナー承認 判断#8）。
 * 距離不明（位置未許可等）の場合は距離を除いた重みで再正規化し、
 * 他の価値観を優先して評価する（オーナー指示）。
 *
 * M6.5改訂（2026-07-21 オーナー承認 判断#4）: 「事情への理解」10%を除外。
 * 他人の子ども情報・理解宣言は profiles_public から取得できない（秘匿）ため、
 * 旧比率 45:15:15:15 をそのまま再正規化した（タグ50%・他は各1/6）。
 */
const WEIGHTS = {
  tags: 0.5,
  distance: 1 / 6,
  times: 1 / 6,
  intent: 1 / 6,
} as const;

/**
 * 距離→係数（M6設計書 B6 ランク表）。
 * 30kmが既定の表示上限のため、通常は0.5以上のレンジで効く。
 */
export function distanceScore(distanceKm: number): number {
  if (distanceKm <= 5) return 1.0;
  if (distanceKm <= 10) return 0.9;
  if (distanceKm <= 20) return 0.7;
  if (distanceKm <= 30) return 0.5;
  if (distanceKm <= 50) return 0.3;
  return 0.15;
}

/** 表示レンジ。0%や100%は出さない（婚活アプリの慣行に合わせ前向きな帯に収める） */
const DISPLAY_MIN = 40;
const DISPLAY_MAX = 98;

/**
 * カード上で相性%を表示する下限（これ未満はスコアを出さず写真・名前・年齢のみ）。
 * 「相性が高い人にだけ特別感を出す」ためのプロダクト仕様（2026-07-06 指示）。
 */
export const COMPATIBILITY_DISPLAY_MIN = 85;

/** カードに相性%を表示すべきか */
export function shouldShowCompatibility(score: number): boolean {
  return score >= COMPATIBILITY_DISPLAY_MIN;
}

function overlapRatio(a: readonly string[], b: readonly string[]): number | null {
  if (a.length === 0 || b.length === 0) return null; // 情報なし→中立扱い
  const setB = new Set(b);
  const shared = a.filter((x) => setB.has(x)).length;
  // 分母は平均個数: 共有が増えるほど単調に上がり、片方が少数タグでも満点に飽和しない
  return Math.min(1, shared / ((a.length + b.length) / 2));
}

/** 結婚意向の近さ（同じ=1.0、隣接=0.7、1段飛び=0.4、両端=0.2） */
const INTENT_ORDER = ['asap', 'within_2y', 'someday', 'partner_only'];

function intentScore(a: string | null, b: string | null): number {
  if (!a || !b) return 0.5;
  const ia = INTENT_ORDER.indexOf(a);
  const ib = INTENT_ORDER.indexOf(b);
  if (ia < 0 || ib < 0) return 0.5;
  const distance = Math.abs(ia - ib);
  return [1.0, 0.7, 0.4, 0.2][distance] ?? 0.2;
}

/**
 * 相性スコアを 40〜98 の整数で返す。
 * 情報が少ない相手でも中立値で計算されるため、必ず表示可能な値が返る。
 *
 * @param distanceKm 現在地からの距離（km）。不明（位置未許可・相手座標なし）は null/未指定。
 *                   不明時は距離を除いた重みで再正規化する（減点しない）。
 */
export function calcCompatibility(
  me: CompatibilityInput,
  other: CompatibilityInput,
  distanceKm?: number | null,
): number {
  const tagRatio = overlapRatio(me.valueTags, other.valueTags) ?? 0.5;
  const timeRatio = overlapRatio(me.availableTimes, other.availableTimes) ?? 0.5;
  const intent = intentScore(me.marriageIntent, other.marriageIntent);

  const base = tagRatio * WEIGHTS.tags + timeRatio * WEIGHTS.times + intent * WEIGHTS.intent;

  const raw =
    distanceKm != null
      ? base + distanceScore(distanceKm) * WEIGHTS.distance
      : base / (1 - WEIGHTS.distance); // 距離不明: 他の価値観のみで再正規化

  return Math.round(DISPLAY_MIN + (DISPLAY_MAX - DISPLAY_MIN) * Math.min(1, raw));
}

/**
 * 相性の「理由」を日本語で返す（M6 B4・with風の共通点演出。診断テストは使わない）。
 * 相性%が表示閾値未満でも共通点があれば表示する。最大4件。
 */
export function compatibilityReasons(
  me: CompatibilityInput,
  other: CompatibilityInput,
  tagLabels: Record<string, string>,
  timeLabels: Record<string, string> = {},
): string[] {
  const reasons: string[] = [];

  // 種類の多様性を優先する並び: タグ(最大2) → 時間帯 → 結婚観 → 残りのタグ数
  const otherTags = new Set(other.valueTags);
  const shared = me.valueTags.filter((t) => otherTags.has(t));
  for (const tag of shared.slice(0, 2)) {
    const label = tagLabels[tag];
    if (label) reasons.push(`お二人とも「${label}」派`);
  }

  const otherTimes = new Set(other.availableTimes);
  const sharedTimes = me.availableTimes.filter((t) => otherTimes.has(t));
  if (sharedTimes.length > 0) {
    const label = timeLabels[sharedTimes[0]] ?? sharedTimes[0];
    reasons.push(`会える時間帯が合います（${label}）`);
  }

  if (me.marriageIntent && me.marriageIntent === other.marriageIntent) {
    reasons.push('結婚への考えが同じです');
  }

  if (shared.length > 2) {
    reasons.push(`ほかにも${shared.length - 2}つの価値観が共通`);
  }

  return reasons.slice(0, 4);
}
