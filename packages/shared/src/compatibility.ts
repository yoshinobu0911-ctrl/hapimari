/**
 * 相性スコア（discoverカードの「相性 XX%」）
 *
 * ユーザーがオンボーディングで選んだ価値観タグを最重視し（50%）、
 * 会える時間帯・結婚意向・子ども/再婚への理解を加味して 0〜100 で返す。
 * 判定はクライアント側の純粋関数（M3の検索・並び替えでも再利用する）。
 */

export interface CompatibilityInput {
  valueTags: readonly string[];
  availableTimes: readonly string[];
  marriageIntent: string | null;
  maritalHistory: string;
  hasChildren: boolean;
  understandsChildren: boolean;
  understandsRemarriage: boolean;
}

const WEIGHTS = {
  tags: 0.5,
  times: 0.2,
  intent: 0.2,
  understanding: 0.1,
} as const;

/** 表示レンジ。0%や100%は出さない（婚活アプリの慣行に合わせ前向きな帯に収める） */
const DISPLAY_MIN = 40;
const DISPLAY_MAX = 98;

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

/** x が y の事情（子ども・再婚歴）を受け止められるか */
function understandingOneWay(x: CompatibilityInput, y: CompatibilityInput): number {
  let score = 1.0;
  if (y.hasChildren && !x.understandsChildren) score -= 0.6;
  if (y.maritalHistory !== 'unmarried' && !x.understandsRemarriage) score -= 0.4;
  return Math.max(0, score);
}

/**
 * 相性スコアを 40〜98 の整数で返す。
 * 情報が少ない相手でも中立値で計算されるため、必ず表示可能な値が返る。
 */
export function calcCompatibility(me: CompatibilityInput, other: CompatibilityInput): number {
  const tagRatio = overlapRatio(me.valueTags, other.valueTags) ?? 0.5;
  const timeRatio = overlapRatio(me.availableTimes, other.availableTimes) ?? 0.5;
  const intent = intentScore(me.marriageIntent, other.marriageIntent);
  const understanding = (understandingOneWay(me, other) + understandingOneWay(other, me)) / 2;

  const raw =
    tagRatio * WEIGHTS.tags +
    timeRatio * WEIGHTS.times +
    intent * WEIGHTS.intent +
    understanding * WEIGHTS.understanding;

  return Math.round(DISPLAY_MIN + (DISPLAY_MAX - DISPLAY_MIN) * raw);
}
