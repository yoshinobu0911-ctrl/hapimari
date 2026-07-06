import { type CompatibilityInput, calcCompatibility } from '@hapimari/shared';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileCard } from '@/components/profile-card';
import { colors, fontSize, spacing } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { infoDialog } from '@/lib/confirm';
import { type Profile, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

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
 * さがす（M1改: 価値観マッチング）
 * カードは「写真・名前・年齢・相性」のみ。相性の高い順に表示する。
 * フィルタ検索・R10隣接県デフォルトは M3 で実装する。
 */
export default function Discover() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const { data: myProfile } = useMyProfile();

  // 異性のみ表示（M3で検索条件として拡張）
  const targetGender = myProfile?.gender === 'male' ? 'female' : 'male';

  const query = useQuery({
    queryKey: ['discover', session?.user.id, targetGender],
    enabled: !!session && !!myProfile,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', session?.user.id ?? '')
        .eq('status', 'active')
        .eq('gender', targetGender)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data;
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
      <Text style={styles.title}>お相手をさがす</Text>
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
              <Text style={styles.empty}>表示できるお相手がまだいません。</Text>
            </View>
          }
          renderItem={({ item }) => (
            <ProfileCard
              profile={item.profile}
              compatibility={item.compatibility}
              onPress={() =>
                infoDialog('プロフィール詳細', '詳細画面と「いいね」はM3で実装予定です。')
              }
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
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
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
