/**
 * フィルタ検索の条件変換（SPEC §5 / docs/design/M3_design.md §5.3）
 *
 * 検索フィルタの状態を PostgREST に依存しない「条件の宣言」に変換する純粋関数。
 * apps/mobile/src/lib/discover-query.ts がこの結果を supabase クエリに薄く適用する。
 * （PostgREST 適用部を薄く保ち、変換ロジックをここで Vitest テストするための分離）
 */

import { type Prefecture, searchArea } from './adjacent_prefectures';
import type { AvailableTime, MaritalHistory, MarriageIntent } from './constants';

/** エリア条件（R10: 既定は「あなたの県+隣接県」） */
export type AreaFilter =
  | { mode: 'default' } // 自県+隣接県
  | { mode: 'all' } // 全国
  | { mode: 'custom'; prefectures: Prefecture[] };

/** フィルタモーダルの状態（SPEC §5 の6項目・すべてAND） */
export interface DiscoverFilter {
  ageMin: number | null;
  ageMax: number | null;
  area: AreaFilter;
  /** 空 or 全選択 = 絞り込みなし */
  maritalHistories: MaritalHistory[];
  children: 'any' | 'has' | 'none';
  /** 空 = 絞り込みなし */
  marriageIntents: MarriageIntent[];
  /** 空 = 絞り込みなし。1つでも重なればヒット（overlaps） */
  availableTimes: AvailableTime[];
}

/** 既定値 = R10 状態（エリアのみ自県+隣接県、他は絞り込みなし） */
export const DEFAULT_DISCOVER_FILTER: DiscoverFilter = {
  ageMin: null,
  ageMax: null,
  area: { mode: 'default' },
  maritalHistories: [],
  children: 'any',
  marriageIntents: [],
  availableTimes: [],
};

/** PostgREST 適用用の条件宣言（null = その条件を適用しない） */
export interface DiscoverConditions {
  /** 異性のみ */
  gender: 'male' | 'female';
  /** n歳以上: birth_date <= この日付（yyyy-mm-dd） */
  birthDateOnOrBefore: string | null;
  /** m歳以下: birth_date > この日付（yyyy-mm-dd） */
  birthDateAfter: string | null;
  /** in 条件。null = 全国 */
  prefectures: string[] | null;
  maritalHistories: string[] | null;
  hasChildren: boolean | null;
  marriageIntents: string[] | null;
  /** overlaps 条件 */
  availableTimesOverlaps: string[] | null;
}

/** now から years 年前の日付を yyyy-mm-dd で返す（ローカル日付基準） */
function isoDateYearsAgo(now: Date, years: number): string {
  const d = new Date(Date.UTC(now.getFullYear() - years, now.getMonth(), now.getDate()));
  return d.toISOString().slice(0, 10);
}

/**
 * フィルタ状態を検索条件に変換する。
 *
 * 年齢→birth_date の変換（calcAge の逆算・両端に注意）:
 *   n歳以上 = birth_date <= today - n years（今日が誕生日の人はちょうど n 歳）
 *   m歳以下 = age < m+1 = birth_date > today - (m+1) years
 */
export function buildDiscoverConditions(
  filter: DiscoverFilter,
  me: { gender: 'male' | 'female'; prefecture: string },
  now: Date = new Date(),
): DiscoverConditions {
  let prefectures: string[] | null = null;
  if (filter.area.mode === 'default') {
    prefectures = searchArea(me.prefecture as Prefecture);
  } else if (filter.area.mode === 'custom') {
    // 0件選択は「全国」と同じ扱い（UI側でも0件確定は防ぐ）
    prefectures = filter.area.prefectures.length > 0 ? [...filter.area.prefectures] : null;
  }

  const allMarital = 3;
  const maritalHistories =
    filter.maritalHistories.length === 0 || filter.maritalHistories.length >= allMarital
      ? null
      : [...filter.maritalHistories];

  return {
    gender: me.gender === 'male' ? 'female' : 'male',
    birthDateOnOrBefore: filter.ageMin != null ? isoDateYearsAgo(now, filter.ageMin) : null,
    birthDateAfter: filter.ageMax != null ? isoDateYearsAgo(now, filter.ageMax + 1) : null,
    prefectures,
    maritalHistories,
    hasChildren: filter.children === 'any' ? null : filter.children === 'has',
    marriageIntents: filter.marriageIntents.length > 0 ? [...filter.marriageIntents] : null,
    availableTimesOverlaps: filter.availableTimes.length > 0 ? [...filter.availableTimes] : null,
  };
}

/** 適用中のフィルタ数（フィルタボタンのバッジ「絞り込み中(n)」用） */
export function countActiveFilters(filter: DiscoverFilter): number {
  let count = 0;
  if (filter.ageMin != null || filter.ageMax != null) count += 1;
  if (filter.area.mode !== 'default') count += 1;
  if (filter.maritalHistories.length > 0 && filter.maritalHistories.length < 3) count += 1;
  if (filter.children !== 'any') count += 1;
  if (filter.marriageIntents.length > 0) count += 1;
  if (filter.availableTimes.length > 0) count += 1;
  return count;
}
