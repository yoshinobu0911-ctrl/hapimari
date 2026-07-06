import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { confirmDialog } from '@/lib/confirm';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

/**
 * ブロックしたユーザーの一覧・解除（docs/design/M3_design.md §5.7）
 * 注: ブロック中はRLSにより相手プロフィールを取得できないため、
 *     ニックネーム等は表示せずブロックした日時のみ表示する（QUESTIONS.md参照）。
 */
export default function BlockedUsers() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const myId = session?.user.id ?? '';

  const query = useQuery({
    queryKey: ['blocks', myId],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blocks')
        .select('*')
        .eq('blocker', myId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const unblock = (blockId: string) => {
    confirmDialog(
      'ブロック解除の確認',
      'ブロックを解除しますか？\n解除すると、お互いのプロフィールが再び表示されるようになります。',
      async () => {
        const { error } = await supabase.from('blocks').delete().eq('id', blockId);
        if (!error) {
          queryClient.invalidateQueries({ queryKey: ['blocks', myId] });
          queryClient.invalidateQueries({ queryKey: ['discover'] });
          queryClient.invalidateQueries({ queryKey: ['received-likes'] });
          queryClient.invalidateQueries({ queryKey: ['matches'] });
        }
      },
    );
  };

  const blocks = query.data ?? [];

  return (
    <Screen
      title="ブロックしたユーザー"
      subtitle="ブロック中はお相手のプロフィールが表示されないため、ブロックした日時のみ表示しています。"
    >
      {query.isPending ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : blocks.length === 0 ? (
        <Text style={styles.empty}>ブロックしたユーザーはいません。</Text>
      ) : (
        <View style={styles.list}>
          {blocks.map((block, index) => {
            const date = block.created_at ? new Date(block.created_at) : null;
            const label = date
              ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日にブロック`
              : 'ブロック中';
            return (
              <View key={block.id} style={styles.row}>
                <Text style={styles.rowText}>
                  ブロック中のユーザー{blocks.length > 1 ? ` ${index + 1}` : ''}
                  {'\n'}
                  <Text style={styles.rowSub}>{label}</Text>
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="ブロックを解除"
                  testID={`unblock-${index}`}
                  onPress={() => unblock(block.id)}
                  style={styles.unblockButton}
                >
                  <Text style={styles.unblockText}>解除</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="戻る"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← マイページへ戻る</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontSize: fontSize.body,
    color: colors.textSub,
    lineHeight: 26,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    padding: spacing.md,
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    fontSize: fontSize.body,
    color: colors.text,
    lineHeight: 24,
  },
  rowSub: {
    color: colors.textSub,
    fontSize: fontSize.small,
  },
  unblockButton: {
    minHeight: sizes.tapArea,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: sizes.radius,
    paddingHorizontal: spacing.md,
  },
  unblockText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '700',
  },
  footer: {
    marginTop: spacing.xl,
  },
  backButton: {
    minHeight: sizes.tapArea,
    justifyContent: 'center',
  },
  backText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '600',
  },
});
