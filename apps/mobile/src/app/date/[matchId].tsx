import { type DateSlot, generateDateSlots, suggestArea } from '@hapimari/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton } from '@/components/ui/app-button';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { confirmDialog } from '@/lib/confirm';
import {
  cancelDate,
  type DateStatus,
  getDateStatus,
  proposeDateSlot,
  respondDateSlot,
  setDateIntent,
  submitDateFeedback,
} from '@/lib/date-api';
import { scheduleFeedbackReminder } from '@/lib/feedback-reminder';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

/**
 * デートの相談（docs/design/M4_design.md §5.2）
 * status に応じて1画面で出し分け（1画面1主要アクション）。
 * R6: 相手の意思は both_agreed 以外の形で画面に出さない。
 */
export default function DateConsult() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const { data: myProfile } = useMyProfile();
  const myId = session?.user.id ?? '';

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<DateSlot | null>(null);
  const [feedbackDone, setFeedbackDone] = useState(false);

  const matchQuery = useQuery({
    queryKey: ['match', matchId],
    enabled: !!matchId && !!session,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('matches')
        .select('*')
        .eq('id', matchId ?? '')
        .maybeSingle();
      if (e) throw e;
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
      const { data, error: e } = await supabase
        .from('profiles_public')
        .select('*')
        .eq('id', partnerId ?? '')
        .maybeSingle();
      if (e) throw e;
      return data;
    },
  });
  const partner = partnerQuery.data;

  const statusQuery = useQuery({
    queryKey: ['date-status', matchId],
    enabled: !!matchId && !!session,
    queryFn: () => getDateStatus(matchId ?? ''),
  });
  const s = statusQuery.data;

  const apply = (next: DateStatus) => {
    queryClient.setQueryData(['date-status', matchId], next);
    queryClient.invalidateQueries({ queryKey: ['messages', matchId] });
  };

  const run = async (action: () => Promise<DateStatus>, after?: (next: DateStatus) => void) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      apply(next);
      after?.(next);
    } catch {
      setError('操作できませんでした。時間をおいてお試しください。');
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="戻る"
        testID="date-back"
        onPress={() => router.back()}
        style={styles.headerButton}
      >
        <Text style={styles.headerButtonText}>← 戻る</Text>
      </Pressable>
      <Text style={styles.headerTitle}>デートの相談</Text>
      <View style={styles.headerButton} />
    </View>
  );

  if (matchQuery.isPending || statusQuery.isPending || !myProfile) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!match || !s) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}>
          <Text style={styles.note}>この画面は表示できません。</Text>
        </View>
      </View>
    );
  }

  const partnerName = partner ? `${partner.nickname}さん` : 'お相手';

  // 2026-07-12: 20通条件は撤廃。マッチ成立直後からデートの相談ができる

  const candidates =
    partner && myProfile
      ? generateDateSlots(myProfile.available_times ?? [], partner.available_times ?? [])
      : [];
  const area = partner?.prefecture ? suggestArea(myProfile.prefecture, partner.prefecture) : null;

  let body: React.ReactNode;

  if (!s.exists || (s.status === 'collecting' && s.my_intent === null)) {
    // 未回答（または done/cancelled 後の再打診）
    body = (
      <>
        <Text style={styles.question}>{partnerName}と、会ってみたいですか？</Text>
        <Text style={styles.note}>
          お相手には、お二人の気持ちが一致するまで<Text style={styles.bold}>何も伝わりません</Text>
          。 「今はまだ」を選んでも、お相手に通知されることはありません。
        </Text>
        <View style={styles.actions}>
          <AppButton
            label="会ってみたい"
            onPress={() => run(() => setDateIntent(matchId ?? '', true))}
            loading={busy}
            testID="date-intent-yes"
          />
          <AppButton
            label="今はまだ"
            variant="secondary"
            onPress={() => run(() => setDateIntent(matchId ?? '', false))}
            testID="date-intent-no"
          />
        </View>
      </>
    );
  } else if (s.status === 'collecting' && s.my_intent === true) {
    body = (
      <>
        <Text style={styles.question}>お気持ちは保存されました</Text>
        <Text style={styles.note}>
          お二人の気持ちが一致したら、チャットでお知らせします。{'\n'}
          （お相手には、まだ何も伝わっていません）
        </Text>
        <View style={styles.actions}>
          <AppButton
            label="気持ちを取り消す"
            variant="secondary"
            onPress={() => run(() => setDateIntent(matchId ?? '', false))}
            loading={busy}
            testID="date-intent-retract"
          />
        </View>
      </>
    );
  } else if (s.status === 'collecting' && s.my_intent === false) {
    body = (
      <>
        <Text style={styles.question}>今はまだ、とお答えいただいています</Text>
        <Text style={styles.note}>
          気が向いたら、いつでも変更できます。お相手に通知されることはありません。
        </Text>
        <View style={styles.actions}>
          <AppButton
            label="会ってみたい に変更する"
            onPress={() => run(() => setDateIntent(matchId ?? '', true))}
            loading={busy}
            testID="date-intent-yes"
          />
        </View>
      </>
    );
  } else if (s.status === 'matched') {
    body = (
      <>
        <Text style={styles.question}>🎉 お二人の「会ってみたい」が一致しました</Text>
        <Text style={styles.note}>
          ご都合のよい日程を1つ選んで、{partnerName}に提案してみましょう。
          {area ? `\n待ち合わせは「${area}」がおすすめです。` : ''}
        </Text>
        <View style={styles.slots}>
          {candidates.map((slot) => {
            const on =
              selectedSlot?.date === slot.date && selectedSlot?.time_range === slot.time_range;
            return (
              <Pressable
                key={`${slot.date}-${slot.time_range}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={slot.label}
                onPress={() => setSelectedSlot(slot)}
                style={[styles.slot, on && styles.slotOn]}
              >
                <Text style={[styles.slotText, on && styles.slotTextOn]}>
                  {on ? '● ' : '○ '}
                  {slot.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.actions}>
          <AppButton
            label="この日程を提案する"
            disabled={!selectedSlot}
            loading={busy}
            onPress={() =>
              selectedSlot && run(() => proposeDateSlot(matchId ?? '', selectedSlot, area))
            }
            testID="date-propose"
          />
        </View>
      </>
    );
  } else if (s.status === 'scheduling' && s.pending_slot) {
    body = s.i_am_proposer ? (
      <>
        <Text style={styles.question}>「{s.pending_slot.label}」を提案中です</Text>
        <Text style={styles.note}>{partnerName}のお返事をお待ちください。</Text>
        <View style={styles.actions}>
          <AppButton
            label="提案を取り下げる"
            variant="secondary"
            loading={busy}
            onPress={() => run(() => respondDateSlot(matchId ?? '', false))}
            testID="date-withdraw"
          />
        </View>
      </>
    ) : (
      <>
        <Text style={styles.question}>
          {partnerName}からの提案: {s.pending_slot.label}
        </Text>
        {s.area_suggestion ? (
          <Text style={styles.note}>待ち合わせの目安: {s.area_suggestion}</Text>
        ) : null}
        <View style={styles.actions}>
          <AppButton
            label="この日程でOK"
            loading={busy}
            onPress={() =>
              run(
                () => respondDateSlot(matchId ?? '', true),
                (next) => {
                  if (next.confirmed_slot) {
                    scheduleFeedbackReminder(next.confirmed_slot, partner?.nickname ?? 'お相手');
                  }
                },
              )
            }
            testID="date-accept"
          />
          <AppButton
            label="別の日程にしたい"
            variant="secondary"
            loading={busy}
            onPress={() => run(() => respondDateSlot(matchId ?? '', false))}
            testID="date-decline-slot"
          />
        </View>
      </>
    );
  } else if (s.status === 'confirmed' && (s.can_feedback || s.my_feedback || feedbackDone)) {
    body =
      s.my_feedback || feedbackDone ? (
        <>
          <Text style={styles.question}>ありがとうございました</Text>
          <Text style={styles.note}>
            ご回答を記録しました。お相手にあなたの回答が表示されることはありません。
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.question}>{partnerName}とのデートはいかがでしたか？</Text>
          <Text style={styles.note}>ご回答はお相手には伝わりません（運営のみが確認します）。</Text>
          <View style={styles.actions}>
            <AppButton
              label="また会いたい"
              loading={busy}
              onPress={() =>
                run(
                  () => submitDateFeedback(matchId ?? '', 'again'),
                  () => setFeedbackDone(true),
                )
              }
              testID="date-feedback-again"
            />
            <AppButton
              label="今回で終わりにする"
              variant="secondary"
              loading={busy}
              onPress={() =>
                run(
                  () => submitDateFeedback(matchId ?? '', 'end'),
                  () => setFeedbackDone(true),
                )
              }
              testID="date-feedback-end"
            />
          </View>
        </>
      );
  } else if (s.status === 'confirmed' && s.confirmed_slot) {
    body = (
      <>
        <Text style={styles.question}>📅 デートが決まっています</Text>
        <View style={styles.confirmedBox}>
          <Text style={styles.confirmedText}>{s.confirmed_slot.label}</Text>
          {s.area_suggestion ? (
            <Text style={styles.confirmedArea}>待ち合わせの目安: {s.area_suggestion}</Text>
          ) : null}
        </View>
        <Text style={styles.note}>
          はじめて会うときは、昼間の人が多い場所がおすすめです。{'\n'}
          金銭や投資の話が出た場合は、会うのをやめて運営への通報をご検討ください。
        </Text>
        <View style={styles.actions}>
          <AppButton
            label="予定を取りやめる"
            variant="danger-outline"
            loading={busy}
            onPress={() =>
              confirmDialog(
                '予定の取りやめ',
                `${partnerName}とのデートの予定を取りやめますか？\nお相手にはチャットでお詫びのメッセージが送られます。`,
                () => run(() => cancelDate(matchId ?? '')),
              )
            }
            testID="date-cancel"
          />
        </View>
      </>
    );
  } else {
    body = <Text style={styles.note}>状態を読み込めませんでした。</Text>;
  }

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll} testID="date-screen">
        {body}
        {error ? (
          <Text style={styles.error} testID="date-error">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    minWidth: 72,
    minHeight: sizes.tapArea,
    justifyContent: 'center',
  },
  headerButtonText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '600',
  },
  headerTitle: {
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
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  question: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 34,
    marginBottom: spacing.md,
  },
  note: {
    fontSize: fontSize.body,
    color: colors.textSub,
    lineHeight: 26,
    marginBottom: spacing.md,
  },
  bold: {
    fontWeight: '700',
    color: colors.text,
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  slots: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  slot: {
    minHeight: sizes.tapArea + 8,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    paddingHorizontal: spacing.md,
  },
  slotOn: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primarySoft,
  },
  slotText: {
    fontSize: fontSize.body + 2,
    color: colors.text,
  },
  slotTextOn: {
    color: colors.primary,
    fontWeight: '700',
  },
  confirmedBox: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: sizes.radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.primarySoft,
  },
  confirmedText: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
  },
  confirmedArea: {
    fontSize: fontSize.body,
    color: colors.textSub,
    marginTop: spacing.xs,
  },
  error: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
    marginTop: spacing.md,
  },
});
