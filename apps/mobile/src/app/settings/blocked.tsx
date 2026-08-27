import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { spacing, typography } from '@/constants/theme';
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
        <View style={styles.skeletons} testID="blocks-loading">
          {[0, 1].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </View>
      ) : blocks.length === 0 ? (
        <EmptyState
          testID="blocks-empty"
          icon="shield-checkmark-outline"
          title="ブロックしたユーザーはいません。"
        />
      ) : (
        <View style={styles.list}>
          {blocks.map((block, index) => {
            const date = block.created_at ? new Date(block.created_at) : null;
            const label = date
              ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日にブロック`
              : 'ブロック中';
            return (
              <Card key={block.id}>
                <View style={styles.row}>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowText}>
                      ブロック中のユーザー{blocks.length > 1 ? ` ${index + 1}` : ''}
                    </Text>
                    <Text style={styles.rowSub}>{label}</Text>
                  </View>
                  <AppButton
                    label="解除"
                    variant="secondary"
                    size="sm"
                    testID={`unblock-${index}`}
                    onPress={() => unblock(block.id)}
                  />
                </View>
              </Card>
            );
          })}
        </View>
      )}
      <View style={styles.footer}>
        <AppButton label="← マイページへ戻る" variant="quiet" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeletons: {
    // SkeletonRow は自前で左右余白を持つため、Screen の余白と二重にならないよう相殺する
    marginHorizontal: -spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowText: {
    ...typography.body,
  },
  rowSub: {
    ...typography.caption,
  },
  footer: {
    marginTop: spacing.xl,
  },
});
