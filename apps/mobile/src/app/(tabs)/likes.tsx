import {
  type CompatibilityInput,
  calcCompatibility,
  shouldShowCompatibility,
} from '@hapimari/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ProfilePhoto } from '@/components/profile-photo';
import { AppButton } from '@/components/ui/app-button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { colors, spacing, typography } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { type Profile, type PublicProfile, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

/** get_received_likes_page の1行（I15） */
type ReceivedLikeRow = {
  like_id: string;
  from_user: string;
  message: string | null;
  created_at: string | null;
  carried_over_count: number;
};

/** 1回の取得件数（RPC 側で 1〜100 に丸められる） */
const PAGE_SIZE = 50;

type LikesPage = {
  likes: ReceivedLikeRow[];
  profiles: Record<string, PublicProfile>;
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
 * I15: 表示日の割当は DB（get_received_likes_page）で全件に対して行い、新しい順に50件ずつ取る。
 *   旧実装の「全件取得→画面で割当」は max_rows=1000 で無言に打ち切られ、新着が欠けていた。
 * カードは一覧カードと同じ原則（写真・名前・年齢・相性85%+のみ + 一言メッセージ）。
 */
export default function Likes() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const { data: myProfile } = useMyProfile();
  const myId = session?.user.id ?? '';

  const query = useInfiniteQuery({
    queryKey: ['received-likes', myId],
    enabled: !!session,
    initialPageParam: null as { createdAt: string | null; id: string } | null,
    queryFn: async ({ pageParam }): Promise<LikesPage> => {
      // 表示日の割当（R4 繰越）とブロック・退会の除外は DB 側で済んでいる（I15）
      const { data, error } = await supabase.rpc('get_received_likes_page', {
        p_before_created_at: pageParam?.createdAt ?? undefined,
        p_before_id: pageParam?.id ?? undefined,
        p_limit: PAGE_SIZE,
      });
      if (error) throw error;
      const likes = (data ?? []) as ReceivedLikeRow[];
      const senderIds = [...new Set(likes.map((l) => l.from_user))];
      if (senderIds.length === 0) return { likes, profiles: {} };
      // 表示に使う公開プロフィールは profiles_public から（公開範囲の判定をビューに一元化）
      const { data: profiles, error: profileError } = await supabase
        .from('profiles_public')
        .select('*')
        .in('id', senderIds);
      if (profileError) throw profileError;
      return {
        likes,
        profiles: Object.fromEntries((profiles as PublicProfile[]).map((p) => [p.id, p])),
      };
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.likes.length < PAGE_SIZE) return undefined;
      const last = lastPage.likes[lastPage.likes.length - 1];
      return last ? { createdAt: last.created_at, id: last.like_id } : undefined;
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

  // 取得済みページを連結（RPC が新しい順・表示日割当済みで返す）
  const pages = query.data?.pages ?? [];
  const profiles: Record<string, PublicProfile> = Object.assign(
    {},
    ...pages.map((page) => page.profiles),
  );
  const items = pages.flatMap((page) => page.likes);
  // 繰越件数は全体の件数（取得済みページの件数からは計算しない）
  const carriedOverCount = pages[0]?.likes[0]?.carried_over_count ?? 0;

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
          {carriedOverCount > 0 ? (
            <Text style={styles.carryNote} testID="likes-carryover">
              ほかに {carriedOverCount} 件のいいねがあり、明日以降に表示されます。
            </Text>
          ) : null}
          {items.map((like) => {
            const sender = profiles[like.from_user];
            if (!sender) return null;
            const compatibility = me ? calcCompatibility(me, toCompatInput(sender)) : 0;
            return (
              <Card
                key={like.like_id}
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
          {query.hasNextPage ? (
            <AppButton
              label="さらに表示"
              variant="secondary"
              onPress={() => query.fetchNextPage()}
              loading={query.isFetchingNextPage}
              testID="likes-more"
            />
          ) : null}
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
