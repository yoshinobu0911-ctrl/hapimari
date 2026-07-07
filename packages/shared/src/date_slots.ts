/**
 * デート日程候補の生成（SPEC §4 R7 / docs/design/M4_design.md §4.1）
 *
 * R7: 提案の時間帯は weekday_lunch / weekend_am を上位固定。
 * 両者の「会える時間帯」の共通部分を使い、共通が無ければ R7 の既定2種にフォールバック。
 * 生成はクライアント側の純粋関数（提案時に選んだ1枠だけが propose_date_slot でDBに渡る）。
 */

import type { AvailableTime } from './constants';
import { toJstDateString } from './like_visibility';

export interface DateSlot {
  /** yyyy-mm-dd（JSTのカレンダー日付） */
  date: string;
  time_range: AvailableTime;
  /** 例: 「7/12(日) 午前」 */
  label: string;
}

/** R7: 上位固定の並び順 */
const R7_ORDER: readonly AvailableTime[] = [
  'weekday_lunch',
  'weekend_am',
  'weekend_pm',
  'weekday_night',
];

/** 共通の時間帯が無い場合の既定（R7の上位2種） */
const R7_DEFAULT: readonly AvailableTime[] = ['weekday_lunch', 'weekend_am'];

const TIME_LABEL: Record<AvailableTime, string> = {
  weekday_lunch: 'ランチ',
  weekend_am: '午前',
  weekend_pm: '午後',
  weekday_night: '夜',
};

const DOW_LABEL = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** yyyy-mm-dd に日数を足す（カレンダー日付として計算） */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** yyyy-mm-dd の曜日（0=日〜6=土） */
function dayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function isWeekend(dateStr: string): boolean {
  const dow = dayOfWeek(dateStr);
  return dow === 0 || dow === 6;
}

function matchesTimeRange(dateStr: string, time: AvailableTime): boolean {
  return time === 'weekend_am' || time === 'weekend_pm'
    ? isWeekend(dateStr)
    : !isWeekend(dateStr);
}

export function slotLabel(dateStr: string, time: AvailableTime): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${DOW_LABEL[dayOfWeek(dateStr)]}) ${TIME_LABEL[time]}`;
}

/**
 * 日程候補を生成する。
 * - 対象期間: 明後日〜14日後（直近すぎる日は避ける）
 * - 時間帯: 両者の共通部分（R7順）。共通なし → R7既定 [weekday_lunch, weekend_am]
 * - 並び: R7上位固定（時間帯優先）。同一時間帯内は日付昇順
 * - 件数: count（既定6）。時間帯ごとに均等割り＋余りは上位の時間帯から埋める
 */
export function generateDateSlots(
  availA: readonly string[],
  availB: readonly string[],
  now: Date = new Date(),
  count = 6,
): DateSlot[] {
  const common = R7_ORDER.filter((t) => availA.includes(t) && availB.includes(t));
  const times = common.length > 0 ? common : [...R7_DEFAULT];

  const today = toJstDateString(now);
  const candidatesByTime = new Map<AvailableTime, DateSlot[]>();
  for (const t of times) {
    const list: DateSlot[] = [];
    for (let offset = 2; offset <= 14; offset++) {
      const date = addDays(today, offset);
      if (matchesTimeRange(date, t)) {
        list.push({ date, time_range: t, label: slotLabel(date, t) });
      }
    }
    candidatesByTime.set(t, list);
  }

  const perTime = Math.ceil(count / times.length);
  const slots: DateSlot[] = [];
  for (const t of times) {
    slots.push(...(candidatesByTime.get(t) ?? []).slice(0, perTime));
  }
  // 均等割りで足りない場合はR7上位の時間帯から追加で埋める
  if (slots.length < count) {
    for (const t of times) {
      const rest = (candidatesByTime.get(t) ?? []).slice(perTime);
      for (const s of rest) {
        if (slots.length >= count) break;
        slots.push(s);
      }
    }
  }
  return slots.slice(0, count);
}
