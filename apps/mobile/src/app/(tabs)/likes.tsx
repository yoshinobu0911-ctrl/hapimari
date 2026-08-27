import {
  assignVisibleDates,
  type CompatibilityInput,
  calcCompatibility,
  FEMALE_DAILY_LIKE_LIMIT,
  shouldShowCompatibility,
} from '@hapimari/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ProfilePhoto } from '@/components/profile-photo';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { colors, spacing, typography } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { type Profile, type PublicProfile, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

type LikeRow = {
  id: string;
  from_user: string;
  to_user: string;
  message: string | null;
  created_at: string | null;
};

function toCompatInput(p: Profile | PublicProfile): CompatibilityInput {
  return {
    valueTags: p.value_tags ?? [],
    availableTimes: p.available_times ?? [],
    marriageIntent: p.marriage_intent,
  };
}

/**
 * お相手から（もらったいいね一覧・docs/design/M3_design.md §5.4）
 * R4: いいねは全件保存されるが、女性側の表示は1日100件まで。超過分は翌日以降に繰越表示。
 * カードは一覧カードと同じ原則（写真・名前・年齢・相性85%+のみ + 一言メッセージ）。
 */
export default function Likes() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const { data: myProfile } = useMyProfile();
  const myId = session?.user.id ?? '';

  const query = useQuery({
    queryKey: ['received-likes', myId],
    enabled: !!session,
    queryFn: async () => {
      const { data: likes, error } = await supabase
        .from('likes')
        .select('*')
        .eq('to_user', myId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const senderIds = [...new Set(likes.map((l) => l.from_user))];
      if (senderIds.length === 0) {
        return { likes: likes as LikeRow[], profiles: {} as Record<string, PublicProfile> };
      }
      // ブロック・退会・凍結済みの送り主はビューの条件により返らない（→一覧から除外される）
      const { data: profiles, error: profileError } = await supabase
        .from('profiles_public')
        .select('*')
        .in('id', senderIds);
      if (profileError) throw profileError;
      return {
        likes: likes as LikeRow[],
        profiles: Object.fromEntries((profiles as PublicProfile[]).map((p) => [p.id, p])) as Record<
          string,
          PublicProfile
        >,
      };
    },
  });

  // Realtime: 新しいいいねをリロードなしで反映
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel(`received-likes-${myId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'likes', filter: `to_user=eq.${myId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['received-likes', myId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myId, queryClient]);

  const me = myProfile ? toCompatInput(myProfile) : null;

  // 表示できる送り主のいいねだけを対象に、R4の表示繰越を適用
  const withProfile = (query.data?.likes ?? []).filter((l) => query.data?.profiles[l.from_user]);
  const limit = myProfile?.gender === 'female' ? FEMALE_DAILY_LIKE_LIMIT : Number.POSITIVE_INFINITY;
  const { visible, carriedOver } = assignVisibleDates(withProfile, limit);
  const items = [...visible].reverse(); // 新しい順に表示

  return (
    <Screen title="お相手からのいいね" scroll={false}>
      {query.isPending ? (
        <View style={styles.skeletons} testID="likes-loading">
          {[0, 1, 2].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </View>
      ) : query.isError ? (
        <EmptyState
          testID="likes-error"
          icon="cloud-offline-outline"
          title="読み込みに失敗しました"
          description="時間をおいてお試しください。"
          actionLabel="もう一度読み込む"
          onAction={() => query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          testID="likes-empty"
          icon="heart-outline"
          title="まだ新しいいいねはありません"
          description="いただいた「いいね」がここに表示されます。"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list} testID="likes-list">
          {carriedOver.length > 0 ? (
            <Text style={styles.carryNote} testID="likes-carryover">
              ほかに {carriedOver.length} 件のいいねがあり、明日以降に表示されます。
            </Text>
          ) : null}
          {items.map((like) => {
            const sender = query.data?.profiles[like.from_user];
            if (!sender) return null;
            const compatibility = me ? calcCompatibility(me, toCompatInput(sender)) : 0;
            return (
              <Card
                key={like.id}
                padded={false}
                accessibilityLabel={`${sender.nickname}さんからのいいね`}
                onPress={() => router.push(`/profile/${sender.id}`)}
              >
                <View style={styles.cardRow}>
                  <ProfilePhoto
                    path={sender.photo_urls?.[0]}
                    style={styles.photo}
                    placeholderStyle={styles.photoPlaceholder}
                    placeholderTextStyle={styles.photoPlaceholderText}
                  />
                  <View style={styles.cardBody}>
                    <Text style={styles.name} numberOfLines={1}>
                      {sender.nickname}
                      <Text style={styles.age}> {sender.age}歳</Text>
                    </Text>
                    {shouldShowCompatibility(compatibility) ? (
                      <Text style={styles.compatibility}>相性 {compatibility}%</Text>
                    ) : null}
                    {like.message ? (
                      <Text style={styles.message} numberOfLines={2}>
                        「{like.message}」
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Card>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeletons: {
    // SkeletonRow は自前で左右余白を持つため、Screen の余白と二重にならないよう相殺する
    marginHorizontal: -spacing.lg,
  },
  list: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  carryNote: {
    ...typography.caption,
  },
  cardRow: {
    flexDirection: 'row',
  },
  photo: {
    width: 104,
    height: 138,
    backgroundColor: colors.surface,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: {
    ...typography.caption,
  },
  cardBody: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  name: {
    ...typography.heading,
  },
  age: {
    ...typography.bodyStrong,
  },
  compatibility: {
    ...typography.heading,
    color: colors.primary,
  },
  message: {
    ...typography.body,
    color: colors.textSub,
  },
});
