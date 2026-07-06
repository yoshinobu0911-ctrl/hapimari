import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { AppTextField } from '@/components/ui/app-text-field';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, spacing } from '@/constants/theme';
import { confirmDialog, infoDialog } from '@/lib/confirm';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

const REPORT_REASONS = [
  { value: '金銭・投資の勧誘', label: '金銭・投資の勧誘' },
  { value: '既婚の疑い', label: '既婚の疑い' },
  { value: '不適切な言動', label: '不適切な言動' },
  { value: 'プロフィール虚偽', label: 'プロフィール虚偽' },
  { value: 'その他', label: 'その他' },
] as const;

/**
 * 通報・ブロック（docs/design/M3_design.md §5.7）
 * 入口: プロフィール詳細の「…」/ チャットのヘッダメニュー / R8バナーの「通報する」
 * ブロックは確認ダイアログ必須（SPEC §2）。RLSにより以後お互いに表示されなくなる。
 */
export default function ReportBlockModal() {
  const { userId, nickname } = useLocalSearchParams<{ userId: string; nickname?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const myId = session?.user.id ?? '';

  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = nickname ? `${nickname}さん` : 'このお相手';

  const submitReport = async () => {
    if (!userId || !reason) return;
    setSubmitting(true);
    setError(null);
    const { error: insertError } = await supabase.from('reports').insert({
      reporter: myId,
      reported: userId,
      reason,
      detail: detail.trim() || null,
    });
    setSubmitting(false);
    if (insertError) {
      setError('送信できませんでした。時間をおいてお試しください。');
      return;
    }
    infoDialog('通報を受け付けました', '運営が内容を確認します。ご協力ありがとうございます。');
    router.back();
  };

  const block = () => {
    if (!userId) return;
    confirmDialog(
      'ブロックの確認',
      `${displayName}をブロックしますか？\nブロックすると、お互いのプロフィールが今後表示されなくなります。この操作はあとから「マイページ > ブロックしたユーザー」で解除できます。`,
      async () => {
        setSubmitting(true);
        setError(null);
        const { error: insertError } = await supabase.from('blocks').insert({
          blocker: myId,
          blocked: userId,
        });
        setSubmitting(false);
        if (insertError) {
          // unique制約違反 = すでにブロック済み
          if (insertError.code === '23505') {
            infoDialog('ブロック済み', 'このお相手はすでにブロックしています。');
            router.back();
            return;
          }
          setError('ブロックできませんでした。時間をおいてお試しください。');
          return;
        }
        // 両方向の表示がRLSで遮断されるため、関連キャッシュをすべて無効化
        queryClient.invalidateQueries({ queryKey: ['discover'] });
        queryClient.invalidateQueries({ queryKey: ['received-likes'] });
        queryClient.invalidateQueries({ queryKey: ['matches'] });
        queryClient.invalidateQueries({ queryKey: ['profile', userId] });
        queryClient.invalidateQueries({ queryKey: ['blocks', myId] });
        infoDialog('ブロックしました', `${displayName}をブロックしました。`);
        router.back();
      },
    );
  };

  return (
    <Screen title="通報・ブロック" subtitle={`${displayName}についての操作を選んでください。`}>
      <Text style={styles.sectionTitle}>運営に通報する</Text>
      <ChoiceGroup
        label="通報の理由"
        options={REPORT_REASONS}
        value={reason}
        onChange={setReason}
      />
      <AppTextField
        label="詳しい状況（任意）"
        placeholder="例）投資の話を持ちかけられた"
        value={detail}
        onChangeText={setDetail}
        multiline
        testID="report-detail"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton
        label="通報する"
        onPress={submitReport}
        disabled={!reason}
        loading={submitting}
        testID="report-submit"
      />

      <View style={styles.divider} />

      <Text style={styles.sectionTitle}>ブロックする</Text>
      <Text style={styles.blockNote}>
        ブロックすると、お互いのプロフィールが検索やいいね一覧に表示されなくなります。
      </Text>
      <AppButton
        label="ブロックする"
        variant="danger-outline"
        onPress={block}
        testID="block-submit"
      />

      <View style={styles.footer}>
        <AppButton
          label="閉じる"
          variant="secondary"
          onPress={() => router.back()}
          testID="report-close"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  blockNote: {
    fontSize: fontSize.body,
    color: colors.textSub,
    lineHeight: 24,
    marginBottom: spacing.md,
  },
  error: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  footer: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
});
