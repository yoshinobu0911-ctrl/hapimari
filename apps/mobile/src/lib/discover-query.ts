/**
 * discover のフィルタ適用（M3設計書 §5.3 / M6設計書 B1・B6 改訂）
 *
 * 条件の変換は @hapimari/shared の buildDiscoverConditions（純粋関数・テスト済み）。
 * 距離の絞り込みはDBでは行えない（座標カラムは遮断済み）ため、
 * 取得後に get_profile_distances RPC の結果へ applyDistanceFilter を適用する。
 */
import {
  applyDistanceFilter,
  buildDiscoverConditions,
  type DiscoverConditions,
  type DiscoverFilter,
  type DiscoverMe,
} from '@hapimari/shared';
import { type Profile, supabase } from '@/lib/supabase';

export interface DiscoverResult {
  profiles: Profile[];
  /** 相手ID→現在地からの距離(km)。自分が位置未許可なら空 */
  distances: Map<string, number>;
}

export function buildDiscoverQuery(filter: DiscoverFilter, me: DiscoverMe & { id: string }) {
  const c: DiscoverConditions = buildDiscoverConditions(filter, me);

  let query = supabase
    .from('profiles')
    .select('*')
    .neq('id', me.id)
    .eq('status', 'active')
    .eq('gender', c.gender);

  if (c.birthDateOnOrBefore) query = query.lte('birth_date', c.birthDateOnOrBefore);
  if (c.birthDateAfter) query = query.gt('birth_date', c.birthDateAfter);
  if (c.prefectures) query = query.in('prefecture', c.prefectures);
  if (c.maritalHistories) query = query.in('marital_history', c.maritalHistories);
  if (c.marriageIntents) query = query.in('marriage_intent', c.marriageIntents);
  if (c.availableTimesOverlaps) query = query.overlaps('available_times', c.availableTimesOverlaps);

  // 距離フィルタで減る分を見込んで多めに取得（MVP規模では十分）
  return query.order('created_at', { ascending: false }).limit(100);
}

/** 相手たちへの丸め距離(km)を取得する。自分が位置未許可なら空Map */
export async function fetchDistances(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc('get_profile_distances', { p_user_ids: userIds });
  if (error || !data) return new Map();
  return new Map(data.map((row) => [row.user_id, row.distance_km]));
}

/** プロフィール取得 → 距離取得 → 距離上限+同一県救済の適用（M6 B6） */
export async function fetchDiscoverProfiles(
  filter: DiscoverFilter,
  me: DiscoverMe & { id: string },
): Promise<DiscoverResult> {
  const { data, error } = await buildDiscoverQuery(filter, me);
  if (error) throw error;
  const profiles = data ?? [];

  const distances = await fetchDistances(profiles.map((p) => p.id));

  const limitKm = filter.area.mode === 'distance' ? filter.area.limitKm : null;
  const visible =
    filter.area.mode === 'distance'
      ? applyDistanceFilter(profiles, distances, limitKm, me.prefecture)
      : profiles;

  return { profiles: visible, distances };
}
