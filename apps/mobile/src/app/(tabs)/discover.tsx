import { type CompatibilityInput, calcCompatibility, countActiveFilters } from '@hapimari/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileCard } from '@/components/profile-card';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { fetchDiscoverProfiles } from '@/lib/discover-query';
import type { Profile } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';
import { useFilterStore } from '@/stores/filter';

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
 * さがす（M3: フィルタ検索・R10隣接県デフォルト・詳細画面への導線）
 * カードは「写真・名前・年齢・相性」のみ。相性の高い順に表示する。
 */
export default function Discover() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const { data: myProfile } = useMyProfile();
  const filter = useFilterStore((s) => s.filter);
  const activeCount = countActiveFilters(filter);

  const query = useQuery({
    queryKey: ['discover', session?.user.id, filter],
    enabled: !!session && !!myProfile,
    queryFn: async () => {
      if (!myProfile) return [];
      return fetchDiscoverProfiles(filter, {
        id: myProfile.id,
        gender: myProfile.gender as 'male' | 'female',
        prefecture: myProfile.prefecture,
      });
    },
  });

  const me = myProfile ? toCompatInput(myProfile) : null;
  const candidates = (query.data ?? [])
    .map((p) => ({
      profile: p,
      compatibility: me ? calcCompatibility(me, toCompatInput(p)) : 50,
    }))
    .sort((a, b) => b.compatibility - a.compatibility);

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
      {query.isPending ? (
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
                条件に合うお相手が見つかりませんでした。{'\n'}絞り込み条件を変えてお試しください。
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ProfileCard
              profile={item.profile}
              compatibility={item.compatibility}
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
