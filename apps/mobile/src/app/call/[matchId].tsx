import {
  type CallEndReason,
  type CallHandle,
  type CallState,
  formatCallDuration,
  remainingCallSeconds,
} from '@hapimari/shared';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton } from '@/components/ui/app-button';
import { colors, sizes, spacing, typography } from '@/constants/theme';
import { callAudioEnabled, callProvider } from '@/lib/call-provider';
import { usePhotoUrl } from '@/lib/photo-url';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

const END_REASON_LABEL: Record<CallEndReason, string> = {
  hangup: '通話が終了しました',
  declined: '今は応答できないようです',
  timeout: '15分の上限に達したため終了しました',
  no_answer: '応答がありませんでした',
  error: '接続できませんでした。時間をおいてお試しください',
  mic_denied:
    'マイクの使用が許可されていません。ブラウザの設定でマイクを許可して、もう一度お試しください',
};

/**
 * 通話画面（docs/design/M5_design.md §5 / M8で実音声に接続）
 * Web = Agora（実音声）／ネイティブ = 当面モック（lib/call-provider.ts で切替・M8 §6-2）。
 * 15分（900秒）で自動切断。サーバー側でもトークン期限（16分）で強制される。
 * callsログは発信者のみが書く。
 */
export default function CallScreen() {
  const { matchId, role } = useLocalSearchParams<{ matchId: string; role?: string }>();
  const isCaller = role !== 'callee';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthStore((s) => s.session);
  const myId = session?.user.id ?? '';

  const [callState, setCallState] = useState<CallState>('idle');
  const [endReason, setEndReason] = useState<CallEndReason | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const handleRef = useRef<CallHandle | null>(null);
  const startedRef = useRef(false);
  const callRowIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const timedOutRef = useRef(false);

  const matchQuery = useQuery({
    queryKey: ['match', matchId],
    enabled: !!matchId && !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId ?? '')
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
      // M6.5: 他人のプロフィールは profiles_public ビュー経由
      const { data, error } = await supabase
        .from('profiles_public')
        .select('nickname, photo_urls')
        .eq('id', partnerId ?? '')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const partnerName = partnerQuery.data?.nickname ? `${partnerQuery.data.nickname}さん` : 'お相手';
  const partnerPhoto = usePhotoUrl(partnerQuery.data?.photo_urls?.[0]);

  // 通話セッションの開始（1回だけ）
  useEffect(() => {
    if (!matchId || !myId || startedRef.current) return;
    startedRef.current = true;

    const events = {
      onStateChange: (state: CallState) => {
        setCallState(state);
        if (state === 'connected' && startedAtRef.current == null) {
          const t = Date.now();
          startedAtRef.current = t;
          setStartedAt(t);
          // ログは発信者のみが書く（二重書き込み防止・設計書§3）
          if (isCaller) {
            supabase
              .from('calls')
              .insert({ match_id: matchId, started_at: new Date(t).toISOString() })
              .select('id')
              .single()
              .then(({ data }) => {
                callRowIdRef.current = data?.id ?? null;
              });
          }
        }
      },
      onEnded: (reason: CallEndReason) => {
        setEndReason(timedOutRef.current ? 'timeout' : reason);
        const began = startedAtRef.current;
        if (isCaller && callRowIdRef.current && began != null) {
          const duration = Math.max(0, Math.floor((Date.now() - began) / 1000));
          supabase
            .from('calls')
            .update({
              ended_at: new Date().toISOString(),
              duration_seconds: duration,
            })
            .eq('id', callRowIdRef.current)
            .then(() => {});
        }
      },
    };

    const start = isCaller
      ? callProvider.startCall(matchId, myId, events)
      : callProvider.joinCall(matchId, myId, events);
    start.then((handle) => {
      handleRef.current = handle;
    });

    return () => {
      handleRef.current?.hangup();
    };
  }, [matchId, myId, isCaller]);

  // 1秒ごとの時計（通話中のみ）と15分自動切断
  useEffect(() => {
    if (callState !== 'connected' || startedAt == null) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (remainingCallSeconds(startedAt, t) <= 0) {
        timedOutRef.current = true;
        handleRef.current?.hangup();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [callState, startedAt]);

  // 終了後は少し待ってチャットへ戻る
  useEffect(() => {
    if (callState !== 'ended') return;
    const timer = setTimeout(() => {
      if (router.canGoBack()) router.back();
    }, 2000);
    return () => clearTimeout(timer);
  }, [callState, router]);

  const elapsed = startedAt != null ? Math.floor((now - startedAt) / 1000) : 0;
  const remaining = startedAt != null ? remainingCallSeconds(startedAt, now) : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl }]}>
      {partnerPhoto ? (
        <Image source={{ uri: partnerPhoto }} style={styles.avatar} contentFit="cover" />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarInitial}>{partnerQuery.data?.nickname?.[0] ?? '👤'}</Text>
        </View>
      )}
      <Text style={styles.partner} testID="call-partner">
        {partnerName}
      </Text>

      <Text style={styles.state} testID="call-state">
        {callState === 'ended' && endReason
          ? END_REASON_LABEL[endReason]
          : callState === 'connected'
            ? '通話中'
            : callState === 'calling'
              ? '呼び出し中…'
              : '接続しています…'}
      </Text>

      {callState === 'connected' ? (
        <View style={styles.timerBox}>
          <Text style={styles.elapsed} testID="call-elapsed">
            {formatCallDuration(elapsed)}
          </Text>
          <Text style={styles.remaining}>
            残り {formatCallDuration(remaining)}（最長15分で自動終了します）
          </Text>
        </View>
      ) : null}

      {callState === 'calling' ? (
        <Text style={styles.hint}>お相手がチャット画面を開いているときにつながります。</Text>
      ) : null}

      {callAudioEnabled ? null : (
        <Text style={styles.mockNote}>
          ※ モック通話です。音声は流れません（正式リリースで通話SDKに接続されます）。
        </Text>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.xl }]}>
        {callState === 'ended' ? (
          <AppButton
            label="チャットへ戻る"
            variant="secondary"
            onPress={() => router.back()}
            testID="call-back"
          />
        ) : (
          <AppButton
            label="通話を終了する"
            onPress={() => handleRef.current?.hangup()}
            testID="call-hangup"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.surface,
    marginTop: spacing.lg,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarInitial: {
    fontSize: 48,
    lineHeight: 56,
    color: colors.textSub,
  },
  partner: {
    ...typography.display,
    marginTop: spacing.lg,
  },
  state: {
    ...typography.headingLg,
    fontWeight: '600',
    color: colors.textSub,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  timerBox: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  elapsed: {
    fontSize: 48,
    lineHeight: 56,
    fontWeight: '700',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  remaining: {
    ...typography.body,
    color: colors.textSub,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  hint: {
    ...typography.body,
    color: colors.textSub,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  mockNote: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  footer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignSelf: 'stretch',
    minHeight: sizes.buttonHeight + spacing.xl,
  },
});
