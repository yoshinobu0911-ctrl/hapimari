import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfileCard } from '@/components/profile-card';
import { colors, fontSize, spacing } from '@/constants/theme';
import { infoDialog } from '@/lib/confirm';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

/**
 * さがす（M1: 自分以外のactiveユーザーをグリッド表示）
 * フィルタ検索・R10隣接県デフォルトは M3 で実装する。
 */
export default function Discover() {
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);

  const query = useQuery({
    queryKey: ['discover', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', session?.user.id ?? '')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data;
    },
  });

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
          data={query.data}
          keyExtractor={(item) => item.id}
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
              profile={item}
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
