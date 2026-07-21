import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfilePhoto } from '@/components/profile-photo';
import { colors, fontSize, spacing } from '@/constants/theme';
import { type PublicProfile, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

type MatchRow = {
  id: string;
  user_a: string;
  user_b: string;
  message_count: number;
  created_at: string | null;
};

type MessageRow = {
  id: string;
  match_id: string;
  sender: string;
  body: string;
  flagged: boolean;
  created_at: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * メッセージ（マッチ一覧・docs/design/M3_design.md §5.5）
 * 行: 相手写真（小・丸）/ 名前 / 最新メッセージ先頭30字 / 日時。未読バッジは作らない。
 */
export default function Messages() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const myId = session?.user.id ?? '';

  const query = useQuery({
    queryKey: ['matches', myId],
    enabled: !!session,
    queryFn: async () => {
      const { data: matches, error } = await supabase
        .from('matches')
        .select('*')
        .or(`user_a.eq.${myId},user_b.eq.${myId}`)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const partnerIds = matches.map((m) => (m.user_a === myId ? m.user_b : m.user_a));
      let profiles: Record<string, PublicProfile> = {};
      if (partnerIds.length > 0) {
        // ブロック・退会済みの相手はビューの条件により返らない（→「表示できないユーザー」扱い）
        const { data: rows, error: profileError } = await supabase
          .from('profiles_public')
          .select('*')
          .in('id', partnerIds);
        if (profileError) throw profileError;
        profiles = Object.fromEntries((rows as PublicProfile[]).map((p) => [p.id, p]));
      }

      // 最新メッセージ: MVPでは全件取得しクライアントで先頭を選ぶ（§5.5）
      const latest: Record<string, MessageRow> = {};
      if (matches.length > 0) {
        const { data: msgs, error: msgError } = await supabase
          .from('messages')
          .select('*')
          .in(
            'match_id',
            matches.map((m) => m.id),
          )
          .order('created_at', { ascending: false });
        if (msgError) throw msgError;
        for (const msg of msgs as MessageRow[]) {
          if (!latest[msg.match_id]) latest[msg.match_id] = msg;
        }
      }
      return { matches: matches as MatchRow[], profiles, latest };
    },
  });

  // Realtime: マッチ成立・新着メッセージをリロードなしで反映
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel(`matches-${myId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, () => {
        queryClient.invalidateQueries({ queryKey: ['matches', myId] });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, () => {
        queryClient.invalidateQueries({ queryKey: ['matches', myId] });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        queryClient.invalidateQueries({ queryKey: ['matches', myId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [myId, queryClient]);

  const matches = query.data?.matches ?? [];

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
      <Text style={styles.title}>メッセージ</Text>
      {query.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : query.isError ? (
        <View style={styles.center}>
          <Text style={styles.empty}>読み込みに失敗しました。時間をおいてお試しください。</Text>
        </View>
      ) : matches.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>
            マッチしたお相手とのやりとりがここに表示されます。{'\n'}
            まずは「さがす」からいいねを送ってみましょう。
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} testID="matches-list">
          {matches.map((match) => {
            const partnerId = match.user_a === myId ? match.user_b : match.user_a;
            const partner = query.data?.profiles[partnerId];
            const lastMessage = query.data?.latest[match.id];
            return (
              <Pressable
                key={match.id}
                accessibilityRole="button"
                accessibilityLabel={
                  partner ? `${partner.nickname}さんとのトーク` : '相手が表示できないトーク'
                }
                onPress={() => router.push(`/chat/${match.id}`)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
              >
                <ProfilePhoto
                  path={partner?.photo_urls?.[0]}
                  style={styles.avatar}
                  placeholderStyle={styles.avatarPlaceholder}
                  placeholderText={partner ? '写真\nなし' : '—'}
                  placeholderTextStyle={styles.avatarPlaceholderText}
                />
                <View style={styles.rowBody}>
                  <Text style={styles.name} numberOfLines={1}>
                    {partner
                      ? `${partner.nickname}（${partner.age}歳）`
                      : '退会またはブロックされたユーザー'}
                  </Text>
                  <Text style={styles.preview} numberOfLines={1}>
                    {lastMessage
                      ? lastMessage.body.slice(0, 30)
                      : 'マッチしました。挨拶してみましょう。'}
                  </Text>
                </View>
                <Text style={styles.time}>
                  {formatDate(lastMessage?.created_at ?? match.created_at)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontSize: fontSize.body,
    color: colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
  },
  list: {
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarPlaceholderText: {
    fontSize: 12,
    color: colors.textSub,
    textAlign: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: fontSize.body + 2,
    fontWeight: '700',
    color: colors.text,
  },
  preview: {
    fontSize: fontSize.body,
    color: colors.textSub,
  },
  time: {
    fontSize: fontSize.small,
    color: colors.textSub,
  },
});
