/**
 * discover のフィルタ適用（docs/design/M3_design.md §5.3）
 *
 * 条件の変換ロジックは @hapimari/shared の buildDiscoverConditions（純粋関数・テスト済み）。
 * ここでは PostgREST のメソッド適用だけを薄く行う。
 */
import {
  buildDiscoverConditions,
  type DiscoverConditions,
  type DiscoverFilter,
} from '@hapimari/shared';
import { type Profile, supabase } from '@/lib/supabase';

export function buildDiscoverQuery(
  filter: DiscoverFilter,
  me: { id: string; gender: 'male' | 'female'; prefecture: string },
) {
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
  if (c.hasChildren != null) query = query.eq('has_children', c.hasChildren);
  if (c.marriageIntents) query = query.in('marriage_intent', c.marriageIntents);
  if (c.availableTimesOverlaps) query = query.overlaps('available_times', c.availableTimesOverlaps);

  return query.order('created_at', { ascending: false }).limit(60);
}

export async function fetchDiscoverProfiles(
  filter: DiscoverFilter,
  me: { id: string; gender: 'male' | 'female'; prefecture: string },
): Promise<Profile[]> {
  const { data, error } = await buildDiscoverQuery(filter, me);
  if (error) throw error;
  return data;
}
