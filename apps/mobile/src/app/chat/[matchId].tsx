import { Ionicons } from '@expo/vector-icons';
import { type CallListener, MESSAGE_BODY_MAX_LENGTH } from '@hapimari/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { AppHeader, HeaderIconButton } from '@/components/ui/app-header';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonRow } from '@/components/ui/skeleton';
import { colors, fontSize, radius, sizes, spacing, typography } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { callAudioEnabled, callProvider } from '@/lib/call-provider';
import { confirmDialog } from '@/lib/confirm';
import { getDateStatus } from '@/lib/date-api';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

type MessageRow = {
  id: string;
  match_id: string;
  sender: string;
  body: string;
  /** user=会員の発言 / system=運営の自動メッセージ（messages.kind 列が正） */
  kind: string;
  flagged: boolean;
  created_at: string | null;
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 運営の自動メッセージの判定は messages.kind 列が正
 * （20260819110000_m7_2b_message_kind.sql。従来の接頭辞ヒューリスティックを置き換えた）。
 * 本文にはRPCが付ける接頭辞（🎉 / 📅）が残っており、運営メッセージ用のアイコンと
 * 重複するため表示からだけ外す。
 */
const SYSTEM_MESSAGE_PREFIXES = ['🎉 ', '📅 '] as const;

function stripSystemPrefix(body: string): string {
  const prefix = SYSTEM_MESSAGE_PREFIXES.find((p) => body.startsWith(p));
  return prefix ? body.slice(prefix.length) : body;
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
  const [incomingCall, setIncomingCall] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const callListenerRef = useRef<CallListener | null>(null);

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

  // デートの相談はマッチ成立直後から利用可（2026-07-12: 20通条件を撤廃）
  const showDateFeature = !!match;
  const dateStatusQuery = useQuery({
    queryKey: ['date-status', matchId],
    enabled: !!matchId && !!session && showDateFeature,
    queryFn: () => getDateStatus(matchId ?? ''),
  });
  const dateStatus = dateStatusQuery.data;

  const partnerQuery = useQuery({
    queryKey: ['profile', partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      // M6.5: 他人のプロフィールは profiles_public ビュー経由
      const { data, error } = await supabase
        .from('profiles_public')
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
          // デート成立/確定の自動メッセージ到着に合わせて状態も更新（M4）
          queryClient.invalidateQueries({ queryKey: ['date-status', matchId] });
          queryClient.invalidateQueries({ queryKey: ['match', matchId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, myId, queryClient]);

  // 着信の監視（この画面が表示されている間のみ。2026-07-12: マッチ成立後すぐ通話可）
  useFocusEffect(
    useCallback(() => {
      if (!matchId || !myId || !match) return;
      const listener = callProvider.listen(matchId, myId, {
        onIncoming: () => setIncomingCall(true),
        onCancelled: () => setIncomingCall(false),
      });
      callListenerRef.current = listener;
      return () => {
        listener.stop();
        callListenerRef.current = null;
        setIncomingCall(false);
      };
    }, [matchId, myId, match]),
  );

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
  // R9: 男性は課金しないと送信不可（閲覧は可・M6）
  const needsSubscription = myProfile?.gender === 'male' && myProfile?.subscription_active !== true;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader
        title={partner ? (partner.nickname ?? '') : '表示できないユーザー'}
        onTitlePress={partner ? () => router.push(`/profile/${partner.id}`) : undefined}
        right={
          partner ? (
            <View style={styles.headerActions}>
              {/* 通話は本人確認の承認後のみ（2026-08-26 決定。サーバー側でも二重に拒否される） */}
              {isVerified ? (
                <HeaderIconButton
                  name="call-outline"
                  label="音声通話"
                  onPress={() =>
                    confirmDialog(
                      '通話を始める前に',
                      `電話番号・LINEなどの連絡先交換は、十分に信頼できるまでお控えください。金銭・投資の話が出たら通話をやめて、運営への通報をご検討ください。\n（最長15分で自動終了します。${callAudioEnabled ? '' : 'モック通話のため音声は流れません。'}）`,
                      async () => {
                        // 着信リスナーを確実に閉じてから通話チャネルへ参加する（同名チャネル競合防止）
                        await callListenerRef.current?.stop();
                        router.push({
                          pathname: '/call/[matchId]',
                          params: { matchId: matchId ?? '', role: 'caller' },
                        });
                      },
                    )
                  }
                />
              ) : null}
              <HeaderIconButton
                name="ellipsis-horizontal"
                label="通報・ブロック"
                onPress={() =>
                  router.push({
                    pathname: '/modal/report-block',
                    params: { userId: partner.id, nickname: partner.nickname },
                  })
                }
              />
            </View>
          ) : null
        }
      />

      {incomingCall && partner ? (
        <View style={styles.incomingBanner} testID="incoming-call">
          <View style={styles.incomingHead}>
            <Ionicons name="call" size={sizes.icon} color={colors.success} />
            <Text style={styles.incomingText}>{partner.nickname}さんから音声通話の着信です</Text>
          </View>
          <View style={styles.incomingActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="応答"
              testID="incoming-accept"
              onPress={async () => {
                setIncomingCall(false);
                // 着信リスナーを確実に閉じてから通話チャネルへ参加する（同名チャネル競合防止）
                await callListenerRef.current?.stop();
                router.push({
                  pathname: '/call/[matchId]',
                  params: { matchId: matchId ?? '', role: 'callee' },
                });
              }}
              style={styles.acceptButton}
            >
              <Text style={styles.acceptText}>応答</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="今は出られない"
              testID="incoming-decline"
              onPress={() => {
                callListenerRef.current?.decline();
                setIncomingCall(false);
              }}
              style={styles.declineButton}
            >
              <Text style={styles.declineText}>今は出られない</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {showDateFeature && match ? (
        <View style={styles.dateBanner}>
          {/*
            v1 は矢印まで含めて1つのテキストにしていたため、文言が長いと
            「→」だけが2行目に落ちて崩れていた。矢印は Banner 側が右端に固定して描く。
          */}
          <Banner
            testID="date-banner"
            tone="primary"
            title={
              dateStatus?.status === 'confirmed' && dateStatus.can_feedback
                ? '昨日のデートはいかがでしたか？'
                : dateStatus?.status === 'confirmed' && dateStatus.confirmed_slot
                  ? 'デートが決まっています'
                  : dateStatus?.my_intent === false
                    ? '気が向いたら「デートの相談」からどうぞ'
                    : 'そろそろ会ってみませんか？'
            }
            description={
              dateStatus?.status === 'confirmed' && dateStatus.can_feedback
                ? 'ひとことお聞かせください'
                : dateStatus?.status === 'confirmed' && dateStatus.confirmed_slot
                  ? (dateStatus.confirmed_slot.label ?? undefined)
                  : dateStatus?.my_intent === false
                    ? undefined
                    : 'デートの相談へ進めます'
            }
            onPress={() => router.push(`/date/${matchId}`)}
          />
        </View>
      ) : null}

      {messagesQuery.isPending || matchQuery.isPending ? (
        <View testID="chat-loading">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      ) : !match ? (
        <EmptyState
          testID="chat-unavailable"
          icon="lock-closed-outline"
          title="このトークは表示できません"
          description="お相手が退会したか、ブロックされた可能性があります。"
        />
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          testID="chat-messages"
        >
          {messages.length === 0 ? (
            <EmptyState
              testID="chat-empty"
              icon="hand-left-outline"
              title="マッチが成立しました"
              description="最初のメッセージを送ってみましょう。"
            />
          ) : null}
          {messages.map((msg, index) => {
            const mine = msg.sender === myId;
            const system = msg.kind === 'system';
            const time = formatTime(msg.created_at);
            // 同じ人・同じ分の連続発言では時刻を最後の1件にだけ出す
            const next = messages[index + 1];
            const showTime =
              !next || next.sender !== msg.sender || formatTime(next.created_at) !== time;

            if (system) {
              return (
                <View key={msg.id} style={styles.systemRow} testID="chat-system-message">
                  <View style={styles.systemBubble}>
                    <Ionicons
                      name="information-circle-outline"
                      size={sizes.iconSm}
                      color={colors.info}
                    />
                    <Text style={styles.systemText}>{stripSystemPrefix(msg.body)}</Text>
                  </View>
                  {showTime ? <Text style={styles.systemTime}>{time}</Text> : null}
                </View>
              );
            }

            return (
              <View key={msg.id}>
                <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
                  <View style={styles.bubbleColumn}>
                    <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                      <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                        {msg.body}
                      </Text>
                    </View>
                    {showTime ? (
                      <Text style={[styles.bubbleTime, mine ? styles.bubbleTimeMine : null]}>
                        {time}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {/* R8: 受信したメッセージが flagged の場合のみ警告（送信者自身には出さない） */}
                {msg.flagged && !mine ? (
                  <View style={styles.fraudBanner}>
                    <Banner
                      testID="fraud-banner"
                      tone="warning"
                      title="金銭・投資などの話題にご注意ください"
                      description="お金の話が出たら、運営への通報をご検討ください。"
                    />
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
                        style={styles.fraudReportButton}
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
        {isVerified && needsSubscription ? (
          <View style={styles.verifyPrompt} testID="chat-paywall">
            <Text style={styles.verifyPromptText}>
              メッセージの送信には有料プランへの登録が必要です。お相手からのメッセージはこのまま読めます。
            </Text>
            <AppButton
              label="プランを見る"
              onPress={() => router.push('/subscription')}
              testID="chat-to-plan"
            />
          </View>
        ) : isVerified ? (
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
              style={({ pressed }) => [
                styles.sendButton,
                pressed && { backgroundColor: colors.primaryPressed },
                (sending || draft.trim().length === 0) && { backgroundColor: colors.disabled },
              ]}
            >
              <Ionicons name="send" size={sizes.iconSm} color={colors.textOnPrimary} />
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateBanner: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  incomingBanner: {
    backgroundColor: colors.successSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.success,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  incomingHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  incomingText: {
    ...typography.bodyStrong,
    flex: 1,
  },
  incomingActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  acceptButton: {
    minHeight: sizes.tapArea,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.success,
    paddingHorizontal: spacing.lg,
  },
  acceptText: {
    ...typography.button,
    color: colors.textOnPrimary,
  },
  declineButton: {
    minHeight: sizes.tapArea,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  declineText: {
    ...typography.button,
    color: colors.textSub,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexGrow: 1,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  /** 吹き出しと時刻を1つの塊にして、時刻が逆側に飛ばないようにする */
  bubbleColumn: {
    maxWidth: '82%',
  },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + spacing.xs,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.sm,
  },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleText: {
    ...typography.body,
  },
  bubbleTextMine: {
    color: colors.textOnPrimary,
  },
  bubbleTime: {
    // 16pt下限（SPEC §2）。v1は12ptで規約違反かつ読めなかった
    fontSize: fontSize.small,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  bubbleTimeMine: {
    textAlign: 'right',
  },
  /** 運営からの自動メッセージ。左右どちらにも寄せず中央に置いて発言と区別する */
  systemRow: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  systemBubble: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    maxWidth: '92%',
    backgroundColor: colors.infoSoft,
    borderWidth: 1,
    borderColor: '#C9DCE8',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  systemText: {
    ...typography.caption,
    color: colors.text,
    flexShrink: 1,
  },
  systemTime: {
    fontSize: fontSize.small,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  fraudBanner: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  fraudReportButton: {
    minHeight: sizes.tapArea,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
  },
  fraudReportLink: {
    ...typography.bodyStrong,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
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
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + spacing.xs,
    fontSize: fontSize.body,
    color: colors.text,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: sizes.inputHeight,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  sendButtonText: {
    ...typography.button,
    color: colors.textOnPrimary,
  },
  verifyPrompt: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  verifyPromptText: {
    ...typography.bodyStrong,
    color: colors.danger,
  },
  sendError: {
    ...typography.bodyStrong,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
});
