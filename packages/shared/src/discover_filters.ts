/**
 * フィルタ検索の条件変換（SPEC §5 / M3設計書 §5.3 / M6設計書 B1・B6 改訂）
 *
 * M6での変更（2026-07-07 オーナー承認）:
 * - 既定エリアは「現在地から30km以内」（距離モード）。R10の県+隣接県は「県で選ぶ」に統合
 * - 「お子さまの有無」フィルタを撤去し、R3は表示段階の除外に変更
 *   （理解宣言のない男性の検索結果に子持ち女性を出さない=案A）
 * - 並び替え（相性順/距離順）をフィルタ状態に追加
 *
 * 距離の絞り込みはDBでは行えない（座標はカラム単位で遮断済み）ため、
 * 取得後に get_profile_distances RPC の結果へ applyDistanceFilter を適用する。
 */

import type { Prefecture } from './adjacent_prefectures';
import type { AvailableTime, MaritalHistory, MarriageIntent } from './constants';

/** エリア条件。distance = 現在地からの距離（既定・R10の後継） */
export type AreaFilter =
  | { mode: 'distance'; limitKm: number | null } // null = 制限なし
  | { mode: 'all' } // 全国
  | { mode: 'custom'; prefectures: Prefecture[] };

/** 距離上限の選択肢（判断#10） */
export const DISTANCE_LIMIT_OPTIONS = [10, 20, 30, 50, 100, null] as const;

/** 既定の距離上限（マッチング限界距離・オーナー決定） */
export const DEFAULT_DISTANCE_LIMIT_KM = 30;

export type DiscoverSort = 'compatibility' | 'distance';

/** フィルタモーダルの状態（すべてAND） */
export interface DiscoverFilter {
  ageMin: number | null;
  ageMax: number | null;
  area: AreaFilter;
  /** 空 or 全選択 = 絞り込みなし */
  maritalHistories: MaritalHistory[];
  /** 空 = 絞り込みなし */
  marriageIntents: MarriageIntent[];
  /** 空 = 絞り込みなし。1つでも重なればヒット（overlaps） */
  availableTimes: AvailableTime[];
  /** 並び替え。距離順は位置情報の許可が必要 */
  sort: DiscoverSort;
}

/** 既定値 = 距離30km・相性順 */
export const DEFAULT_DISCOVER_FILTER: DiscoverFilter = {
  ageMin: null,
  ageMax: null,
  area: { mode: 'distance', limitKm: DEFAULT_DISTANCE_LIMIT_KM },
  maritalHistories: [],
  marriageIntents: [],
  availableTimes: [],
  sort: 'compatibility',
};

/** PostgREST 適用用の条件宣言（null = その条件を適用しない） */
export interface DiscoverConditions {
  gender: 'male' | 'female';
  birthDateOnOrBefore: string | null;
  birthDateAfter: string | null;
  /** in 条件。null = 県で絞らない（距離モード・全国） */
  prefectures: string[] | null;
  maritalHistories: string[] | null;
  marriageIntents: string[] | null;
  availableTimesOverlaps: string[] | null;
  /** 距離モード時の上限（取得後に applyDistanceFilter で適用）。null = 距離絞り込みなし */
  distanceLimitKm: number | null;
}

function isoDateYearsAgo(now: Date, years: number): string {
  const d = new Date(Date.UTC(now.getFullYear() - years, now.getMonth(), now.getDate()));
  return d.toISOString().slice(0, 10);
}

export interface DiscoverMe {
  gender: 'male' | 'female';
  prefecture: string;
}

/** フィルタ状態を検索条件に変換する（年齢→birth_date の変換規則はM3から不変） */
export function buildDiscoverConditions(
  filter: DiscoverFilter,
  me: DiscoverMe,
  now: Date = new Date(),
): DiscoverConditions {
  let prefectures: string[] | null = null;
  if (filter.area.mode === 'custom') {
    prefectures = filter.area.prefectures.length > 0 ? [...filter.area.prefectures] : null;
  }

  const maritalHistories =
    filter.maritalHistories.length === 0 || filter.maritalHistories.length >= 3
      ? null
      : [...filter.maritalHistories];

  return {
    gender: me.gender === 'male' ? 'female' : 'male',
    birthDateOnOrBefore: filter.ageMin != null ? isoDateYearsAgo(now, filter.ageMin) : null,
    birthDateAfter: filter.ageMax != null ? isoDateYearsAgo(now, filter.ageMax + 1) : null,
    prefectures,
    maritalHistories,
    // R3（子持ち理解ゲート）は2026-07-12オーナー指示で撤廃（誰にでも全員が表示される）
    marriageIntents: filter.marriageIntents.length > 0 ? [...filter.marriageIntents] : null,
    availableTimesOverlaps: filter.availableTimes.length > 0 ? [...filter.availableTimes] : null,
    distanceLimitKm: filter.area.mode === 'distance' ? filter.area.limitKm : null,
  };
}

/**
 * 距離フィルタの適用（取得後・クライアント側）。
 * - 距離が分かるペア: distance <= limit のみ残す
 * - 距離不明のペア（どちらかが位置未許可）: 「同一県なら常に表示」の救済則（オーナー承認 判断#10）
 */
export function applyDistanceFilter<T extends { id: string; prefecture: string }>(
  profiles: readonly T[],
  distances: ReadonlyMap<string, number>,
  limitKm: number | null,
  myPrefecture: string,
): T[] {
  return profiles.filter((p) => {
    const d = distances.get(p.id);
    if (d == null) return p.prefecture === myPrefecture;
    if (limitKm == null) return true;
    return d <= limitKm;
  });
}

/**
 * 距離の表示ラベル（プライバシー配慮の丸め・M6 B6）。
 * 5km未満は「5km以内」、〜30kmは5km刻み、〜100kmは10km刻み、それ以上は「100km以上」
 */
export function formatDistanceLabel(distanceKm: number): string {
  if (distanceKm < 5) return '5km以内';
  if (distanceKm <= 30) return `約${Math.max(5, Math.round(distanceKm / 5) * 5)}km`;
  if (distanceKm <= 100) return `約${Math.round(distanceKm / 10) * 10}km`;
  return '100km以上';
}

/** 適用中のフィルタ数（「絞り込み中(n)」バッジ用。既定＝0） */
export function countActiveFilters(filter: DiscoverFilter): number {
  let count = 0;
  if (filter.ageMin != null || filter.ageMax != null) count += 1;
  const areaIsDefault =
    filter.area.mode === 'distance' && filter.area.limitKm === DEFAULT_DISTANCE_LIMIT_KM;
  if (!areaIsDefault) count += 1;
  if (filter.maritalHistories.length > 0 && filter.maritalHistories.length < 3) count += 1;
  if (filter.marriageIntents.length > 0) count += 1;
  if (filter.availableTimes.length > 0) count += 1;
  return count;
}
