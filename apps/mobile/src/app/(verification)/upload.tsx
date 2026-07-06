import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { useMyVerifications } from '@/hooks/use-my-verifications';
import { supabase } from '@/lib/supabase';
import { uploadVerificationDocument, type VerificationKind } from '@/lib/upload-verification';
import { useAuthStore } from '@/stores/auth';

interface KindDef {
  kind: VerificationKind;
  title: string;
  required: boolean;
  description: string;
}

const KINDS: KindDef[] = [
  {
    kind: 'identity',
    title: '本人確認書類',
    required: true,
    description: '運転免許証・マイナンバーカード・パスポートなど（氏名と生年月日が確認できるもの）',
  },
  {
    kind: 'income',
    title: '収入証明（任意）',
    required: false,
    description: '源泉徴収票・確定申告書など。提出するとバッジが表示されます',
  },
  {
    kind: 'single_cert',
    title: '独身証明（任意）',
    required: false,
    description: '独身証明書（本籍地の市区町村で取得できます）',
  },
];

type KindStatus = '未提出' | '審査中' | '承認済み' | '却下';

export default function VerificationUpload() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const { data: profile } = useMyProfile();
  const verificationsQuery = useMyVerifications();
  const [busyKind, setBusyKind] = useState<VerificationKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session || !profile) return null;

  const approvedByProfile: Record<VerificationKind, boolean> = {
    identity: profile.is_verified,
    income: profile.income_verified,
    single_cert: profile.single_cert_verified,
  };

  const statusOf = (kind: VerificationKind): { status: KindStatus; reason?: string } => {
    if (approvedByProfile[kind]) return { status: '承認済み' };
    const latest = verificationsQuery.data?.find((v) => v.kind === kind);
    if (!latest) return { status: '未提出' };
    if (latest.status === 'pending') return { status: '審査中' };
    if (latest.status === 'rejected')
      return { status: '却下', reason: latest.reject_reason ?? undefined };
    return { status: '承認済み' };
  };

  const submit = async (kind: VerificationKind) => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      base64: true,
    });
    if (result.canceled || !result.assets[0]) return;
    setBusyKind(kind);
    try {
      const path = await uploadVerificationDocument(session.user.id, kind, result.assets[0]);
      const { error: insertError } = await supabase.from('verifications').insert({
        user_id: session.user.id,
        kind,
        document_url: path,
      });
      if (insertError) throw new Error(insertError.message);
      await queryClient.invalidateQueries({ queryKey: ['my-verifications', session.user.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : '提出に失敗しました');
    } finally {
      setBusyKind(null);
    }
  };

  return (
    <Screen
      title="証明書類の提出"
      subtitle="ご提出いただいた書類は運営が目視で確認します。審査は通常1〜2営業日です。書類の画像はお相手には公開されません。"
    >
      {KINDS.map((def) => {
        const { status, reason } = statusOf(def.kind);
        return (
          <View key={def.kind} style={styles.item}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemTitle}>{def.title}</Text>
              <Text
                style={[
                  styles.status,
                  status === '承認済み' && styles.statusApproved,
                  status === '審査中' && styles.statusPending,
                  status === '却下' && styles.statusRejected,
                ]}
                testID={`status-${def.kind}`}
              >
                {status}
              </Text>
            </View>
            <Text style={styles.description}>{def.description}</Text>
            {reason ? <Text style={styles.reason}>却下理由: {reason}</Text> : null}
            {status === '承認済み' ? null : status === '審査中' ? (
              <Text style={styles.pendingNote}>審査をお待ちください。</Text>
            ) : (
              <AppButton
                label={status === '却下' ? '書類を再提出する' : '書類を提出する'}
                variant={def.required ? 'primary' : 'secondary'}
                loading={busyKind === def.kind}
                onPress={() => submit(def.kind)}
                testID={`submit-${def.kind}`}
              />
            )}
          </View>
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label="マイページへ戻る" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
  },
  status: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.textSub,
  },
  statusApproved: {
    color: colors.success,
  },
  statusPending: {
    color: '#B7791F',
  },
  statusRejected: {
    color: colors.danger,
  },
  description: {
    fontSize: fontSize.small,
    color: colors.textSub,
    lineHeight: 22,
  },
  reason: {
    fontSize: fontSize.small,
    color: colors.danger,
    lineHeight: 22,
  },
  pendingNote: {
    fontSize: fontSize.body,
    color: colors.textSub,
  },
  error: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
});
