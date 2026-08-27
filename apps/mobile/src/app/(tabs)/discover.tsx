import { Ionicons } from '@expo/vector-icons';
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
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileCard } from '@/components/profile-card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonCard } from '@/components/ui/skeleton';
import { colors, sizes, spacing, typography } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { fetchDiscoverProfiles } from '@/lib/discover-query';
import { syncMyLocation } from '@/lib/location';
import type { Profile, PublicProfile } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';
import { useFilterStore } from '@/stores/filter';
import { useLocationStore } from '@/stores/location';

// M6.5: 相性計算はタグ・時間帯・結婚観のみ（理解項目は廃止・秘匿情報を使わない）
function toCompatInput(p: Profile | PublicProfile): CompatibilityInput {
  return {
    valueTags: p.value_tags ?? [],
    availableTimes: p.available_times ?? [],
    marriageIntent: p.marriage_intent,
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

  // GPS取得を待たずに一覧を表示する（距離はDB保存座標から計算されるため、
  // 同期が終わったら gpsAvailable の変化で自動的に再取得される）
  const query = useQuery({
    queryKey: ['discover', session?.user.id, filter, gpsAvailable],
    enabled: !!session && !!myProfile,
    queryFn: async () => {
      if (!myProfile) return { profiles: [], distances: new Map<string, number>() };
      return fetchDiscoverProfiles(filter, {
        id: myProfile.id,
        gender: myProfile.gender as 'male' | 'female',
        prefecture: myProfile.prefecture,
      });
    },
  });

  const me = myProfile ? toCompatInput(myProfile) : null;
  const distances = query.data?.distances ?? new Map<string, number>();
  // 距離ソートの可否は「距離が実際に取れているか」で判定する
  // （過去にスマホで許可済みならDBに座標があり、今セッションのGPS結果に依らず使える）
  const distanceAvailable = distances.size > 0;

  useEffect(() => {
    if (distanceAvailable && gpsAvailable !== true) setGpsAvailable(true);
  }, [distanceAvailable, gpsAvailable, setGpsAvailable]);
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
          <Ionicons
            name="options-outline"
            size={sizes.iconSm}
            color={activeCount > 0 ? colors.textOnPrimary : colors.primary}
          />
          <Text style={[styles.filterButtonText, activeCount > 0 && styles.filterButtonTextActive]}>
            {activeCount > 0 ? `絞り込み中(${activeCount})` : '絞り込み'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.sortRow}>
        <Chip
          label="相性順"
          testID="sort-compatibility"
          state={filter.sort === 'compatibility' ? 'selected' : 'default'}
          onPress={() => setSort('compatibility')}
        />
        {/* 距離が取れていないときは押せない。色だけに頼らず薄くして無効を示す */}
        <View style={!distanceAvailable && styles.sortChipDisabled}>
          <Chip
            label="距離が近い順"
            testID="sort-distance"
            state={filter.sort === 'distance' ? 'selected' : 'default'}
            onPress={distanceAvailable ? () => setSort('distance') : undefined}
          />
        </View>
        {!query.isPending && !distanceAvailable ? (
          <Text style={styles.gpsHint} testID="gps-hint">
            位置情報を許可すると距離順に並べ替えできます
          </Text>
        ) : null}
      </View>

      {query.isPending ? (
        // 素のスピナーだと「何が出てくるのか」が分からないため、
        // 実際のグリッドと同じ形の骨組みを見せる（designer_brief §2.3-4）
        <View style={styles.skeletonGrid} testID="discover-loading">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonCell}>
              <SkeletonCard />
            </View>
          ))}
        </View>
      ) : query.isError ? (
        <EmptyState
          testID="discover-error"
          icon="cloud-offline-outline"
          title="読み込めませんでした"
          description="通信の状態をご確認のうえ、もう一度お試しください。"
          actionLabel="もう一度読み込む"
          onAction={() => query.refetch()}
        />
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
            <EmptyState
              testID="discover-empty"
              icon="search-outline"
              title="条件に合うお相手が見つかりませんでした"
              description="絞り込みの距離を広げるなど、条件を変えてお試しください。"
              actionLabel="絞り込みを変更する"
              onAction={() => router.push('/modal/filter')}
            />
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
    ...typography.title,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
    ...typography.bodyStrong,
    color: colors.primary,
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
  sortChipDisabled: {
    opacity: 0.5,
  },
  gpsHint: {
    ...typography.caption,
  },
  list: {
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  skeletonCell: {
    width: '50%',
    flexDirection: 'row',
  },
});
