import {
  type CompatibilityInput,
  calcCompatibility,
  countActiveFilters,
  type DiscoverSort,
  formatDistanceLabel,
} from '@hapimari/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileCard } from '@/components/profile-card';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { fetchDiscoverProfiles } from '@/lib/discover-query';
import { syncMyLocation } from '@/lib/location';
import type { Profile } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';
import { useFilterStore } from '@/stores/filter';
import { useLocationStore } from '@/stores/location';

function toCompatInput(p: Profile): CompatibilityInput {
  return {
    valueTags: p.value_tags ?? [],
    availableTimes: p.available_times ?? [],
    marriageIntent: p.marriage_intent,
    maritalHistory: p.marital_history,
    hasChildren: p.has_children,
    understandsChildren: p.understands_children,
    understandsRemarriage: p.understands_remarriage,
  };
}

/**
 * さがす（M6: 距離マッチング・並び替え・R3表示除外）
 * 既定は「現在地から30km以内」を相性順に表示。距離順は位置情報の許可が必要。
 */
export default function Discover() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const { data: myProfile } = useMyProfile();
  const filter = useFilterStore((s) => s.filter);
  const setFilter = useFilterStore((s) => s.setFilter);
  const { gpsAvailable, setGpsAvailable } = useLocationStore();
  const activeCount = countActiveFilters(filter);
  const locationSyncedRef = useRef(false);

  // 現在地の取得と保存（セッション中1回。未許可でも全機能そのまま）
  useEffect(() => {
    const myId = session?.user.id;
    if (!myId || locationSyncedRef.current) return;
    locationSyncedRef.current = true;
    syncMyLocation(myId).then(setGpsAvailable);
  }, [session?.user.id, setGpsAvailable]);

  const query = useQuery({
    queryKey: ['discover', session?.user.id, filter, gpsAvailable],
    enabled: !!session && !!myProfile && gpsAvailable !== null,
    queryFn: async () => {
      if (!myProfile) return { profiles: [], distances: new Map<string, number>() };
      return fetchDiscoverProfiles(filter, {
        id: myProfile.id,
        gender: myProfile.gender as 'male' | 'female',
        prefecture: myProfile.prefecture,
        understandsChildren: myProfile.understands_children,
      });
    },
  });

  const me = myProfile ? toCompatInput(myProfile) : null;
  const distances = query.data?.distances ?? new Map<string, number>();
  const candidates = (query.data?.profiles ?? [])
    .map((p) => {
      const distanceKm = distances.get(p.id) ?? null;
      return {
        profile: p,
        distanceKm,
        compatibility: me ? calcCompatibility(me, toCompatInput(p), distanceKm) : 50,
      };
    })
    .sort((a, b) => {
      if (filter.sort === 'distance') {
        const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
        const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
      }
      return b.compatibility - a.compatibility;
    });

  const setSort = (sort: DiscoverSort) => setFilter({ ...filter, sort });

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>お相手をさがす</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="絞り込み"
          testID="discover-filter"
          onPress={() => router.push('/modal/filter')}
          style={[styles.filterButton, activeCount > 0 && styles.filterButtonActive]}
        >
          <Text style={[styles.filterButtonText, activeCount > 0 && styles.filterButtonTextActive]}>
            {activeCount > 0 ? `絞り込み中(${activeCount})` : '絞り込み'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.sortRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="相性順"
          testID="sort-compatibility"
          onPress={() => setSort('compatibility')}
          style={[styles.sortChip, filter.sort === 'compatibility' && styles.sortChipOn]}
        >
          <Text
            style={[styles.sortChipText, filter.sort === 'compatibility' && styles.sortChipTextOn]}
          >
            相性順
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="距離が近い順"
          testID="sort-distance"
          disabled={gpsAvailable !== true}
          onPress={() => setSort('distance')}
          style={[
            styles.sortChip,
            filter.sort === 'distance' && styles.sortChipOn,
            gpsAvailable !== true && styles.sortChipDisabled,
          ]}
        >
          <Text
            style={[
              styles.sortChipText,
              filter.sort === 'distance' && styles.sortChipTextOn,
              gpsAvailable !== true && styles.sortChipTextDisabled,
            ]}
          >
            距離が近い順
          </Text>
        </Pressable>
        {gpsAvailable === false ? (
          <Text style={styles.gpsHint} testID="gps-hint">
            位置情報を許可すると距離順に並べ替えできます
          </Text>
        ) : null}
      </View>

      {query.isPending || gpsAvailable === null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : query.isError ? (
        <View style={styles.center}>
          <Text style={styles.empty}>読み込みに失敗しました。時間をおいてお試しください。</Text>
        </View>
      ) : (
        <FlatList
          testID="discover-list"
          data={candidates}
          keyExtractor={(item) => item.profile.id}
          numColumns={2}
          refreshing={query.isRefetching}
          onRefresh={() => query.refetch()}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>
                条件に合うお相手が見つかりませんでした。{'\n'}
                絞り込みの距離を広げるなど、条件を変えてお試しください。
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ProfileCard
              profile={item.profile}
              compatibility={item.compatibility}
              distanceLabel={
                item.distanceKm != null ? formatDistanceLabel(item.distanceKm) : undefined
              }
              onPress={() => router.push(`/profile/${item.profile.id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
  },
  filterButton: {
    minHeight: sizes.tapArea,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: sizes.radius,
    paddingHorizontal: spacing.md,
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterButtonText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: colors.textOnPrimary,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  sortChip: {
    minHeight: sizes.tapArea - 6,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
  },
  sortChipOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  sortChipDisabled: {
    opacity: 0.5,
  },
  sortChipText: {
    fontSize: fontSize.body,
    color: colors.textSub,
    fontWeight: '600',
  },
  sortChipTextOn: {
    color: colors.primary,
    fontWeight: '700',
  },
  sortChipTextDisabled: {
    color: colors.disabled,
  },
  gpsHint: {
    fontSize: fontSize.small,
    color: colors.textSub,
  },
  list: {
    paddingBottom: spacing.xl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  empty: {
    fontSize: fontSize.body,
    color: colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
  },
});
