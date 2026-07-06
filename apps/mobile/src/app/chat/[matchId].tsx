import { MESSAGE_BODY_MAX_LENGTH } from '@hapimari/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton } from '@/components/ui/app-button';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

type MessageRow = {
  id: string;
  match_id: string;
  sender: string;
  body: string;
  flagged: boolean;
  created_at: string | null;
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * トーク画面（docs/design/M3_design.md §5.6）
 * - メッセージは RLS 直INSERT（R2: 本人確認済みのみ・当事者のみはRLSが担保）
 * - Realtime購読でリロードなしに新着反映（受け入れ条件1）
 * - 受信メッセージが flagged=true なら直下にR8警告バナー（受け入れ条件3）
 * - 少件数でのWeb描画の確実性を優先し ScrollView+map（§1.2-6 の既知の癖への対応）
 */
export default function Chat() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const { data: myProfile } = useMyProfile();
  const myId = session?.user.id ?? '';

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const matchQuery = useQuery({
    queryKey: ['match', matchId],
    enabled: !!matchId && !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const match = matchQuery.data;
  const partnerId = match ? (match.user_a === myId ? match.user_b : match.user_a) : null;

  const partnerQuery = useQuery({
    queryKey: ['profile', partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', partnerId ?? '')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const messagesQuery = useQuery({
    queryKey: ['messages', matchId],
    enabled: !!matchId && !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('match_id', matchId ?? '')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as MessageRow[];
    },
  });

  // Realtime: このマッチの新着メッセージを購読（受け入れ条件1の核）
  useEffect(() => {
    if (!matchId) return;
    const channel = supabase
      .channel(`chat-${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['messages', matchId] });
          queryClient.invalidateQueries({ queryKey: ['matches', myId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, myId, queryClient]);

  const messages = messagesQuery.data ?? [];

  // 新着時に最下部へスクロール
  // biome-ignore lint/correctness/useExhaustiveDependencies: メッセージ件数の変化で発火させる
  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(timer);
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !matchId) return;
    setSending(true);
    setSendError(null);
    const { error } = await supabase.from('messages').insert({
      match_id: matchId,
      sender: myId,
      body,
    });
    setSending(false);
    if (error) {
      // RLS拒否（未認証・凍結・当事者でない）等
      setSendError(
        '送信できませんでした。本人確認の状態をご確認のうえ、時間をおいてお試しください。',
      );
      return;
    }
    setDraft('');
    queryClient.invalidateQueries({ queryKey: ['messages', matchId] });
  };

  const partner = partnerQuery.data;
  const isVerified = myProfile?.is_verified === true;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="戻る"
          testID="chat-back"
          onPress={() => router.back()}
          style={styles.headerButton}
        >
          <Text style={styles.headerButtonText}>← 戻る</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="お相手のプロフィール"
          testID="chat-partner"
          disabled={!partner}
          onPress={() => partner && router.push(`/profile/${partner.id}`)}
          style={styles.headerName}
        >
          <Text style={styles.headerNameText} numberOfLines={1}>
            {partner ? partner.nickname : '表示できないユーザー'}
          </Text>
        </Pressable>
        {partner ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="通報・ブロック"
            testID="chat-menu"
            onPress={() =>
              router.push({
                pathname: '/modal/report-block',
                params: { userId: partner.id, nickname: partner.nickname },
              })
            }
            style={styles.headerButton}
          >
            <Text style={styles.headerButtonText}>…</Text>
          </Pressable>
        ) : (
          <View style={styles.headerButton} />
        )}
      </View>

      {messagesQuery.isPending || matchQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : !match ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>このトークは表示できません。</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          testID="chat-messages"
        >
          {messages.length === 0 ? (
            <Text style={styles.emptyText}>
              マッチが成立しました。{'\n'}最初のメッセージを送ってみましょう。
            </Text>
          ) : null}
          {messages.map((msg) => {
            const mine = msg.sender === myId;
            return (
              <View key={msg.id}>
                <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                      {msg.body}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.bubbleTime, mine ? styles.bubbleTimeMine : null]}>
                  {formatTime(msg.created_at)}
                </Text>
                {/* R8: 受信したメッセージが flagged の場合のみ警告（送信者自身には出さない） */}
                {msg.flagged && !mine ? (
                  <View style={styles.fraudBanner} testID="fraud-banner">
                    <Text style={styles.fraudBannerText}>
                      ⚠
                      金銭・投資などの話題にご注意ください。お金の話が出たら、運営への通報をご検討ください。
                    </Text>
                    {partner ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="通報する"
                        testID="fraud-report"
                        onPress={() =>
                          router.push({
                            pathname: '/modal/report-block',
                            params: { userId: partner.id, nickname: partner.nickname },
                          })
                        }
                      >
                        <Text style={styles.fraudReportLink}>通報する</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
        {sendError ? (
          <Text style={styles.sendError} testID="chat-send-error">
            {sendError}
          </Text>
        ) : null}
        {isVerified ? (
          <View style={styles.composerRow}>
            <TextInput
              style={styles.input}
              placeholder="メッセージを入力"
              placeholderTextColor={colors.textSub}
              value={draft}
              onChangeText={setDraft}
              maxLength={MESSAGE_BODY_MAX_LENGTH}
              multiline
              accessibilityLabel="メッセージを入力"
              testID="chat-input"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="送信"
              testID="chat-send"
              disabled={sending || draft.trim().length === 0}
              onPress={send}
              style={[
                styles.sendButton,
                (sending || draft.trim().length === 0) && { backgroundColor: colors.disabled },
              ]}
            >
              <Text style={styles.sendButtonText}>送信</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.verifyPrompt}>
            <Text style={styles.verifyPromptText}>メッセージの送信には本人確認が必要です。</Text>
            <AppButton
              label="証明書類を提出する"
              onPress={() => router.push('/upload')}
              testID="chat-verify"
            />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  headerButton: {
    minHeight: sizes.tapArea,
    minWidth: sizes.tapArea,
    justifyContent: 'center',
  },
  headerButtonText: {
    fontSize: fontSize.heading,
    color: colors.primary,
    fontWeight: '600',
  },
  headerName: {
    flex: 1,
    minHeight: sizes.tapArea,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerNameText: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
    paddingVertical: spacing.lg,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: sizes.radius + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
  },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText: {
    fontSize: fontSize.body,
    color: colors.text,
    lineHeight: 24,
  },
  bubbleTextMine: {
    color: colors.textOnPrimary,
  },
  bubbleTime: {
    fontSize: 12,
    color: colors.textSub,
    marginTop: 2,
  },
  bubbleTimeMine: {
    textAlign: 'right',
  },
  fraudBanner: {
    backgroundColor: '#FDF3E7',
    borderWidth: 1,
    borderColor: '#E67E22',
    borderRadius: sizes.radius,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  fraudBannerText: {
    fontSize: fontSize.body,
    color: '#8E4B10',
    lineHeight: 24,
  },
  fraudReportLink: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: sizes.inputHeight,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.body,
    color: colors.text,
  },
  sendButton: {
    height: sizes.inputHeight,
    borderRadius: sizes.radius,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sendButtonText: {
    fontSize: fontSize.button,
    color: colors.textOnPrimary,
    fontWeight: '700',
  },
  verifyPrompt: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  verifyPromptText: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
  },
  sendError: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
});
