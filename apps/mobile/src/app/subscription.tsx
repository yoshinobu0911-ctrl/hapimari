import { SUBSCRIPTION_PLANS } from '@hapimari/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { paymentProvider } from '@/lib/payment';

/**
 * 有料プラン（M6 A1・モック課金）
 * 男性: スタンダードプラン（価格は正式リリース時に決定・判断#4）
 * 女性: 現在は無料（女性プレミアはB5の将来枠・UIには出さない）
 */
export default function Subscription() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: myProfile } = useMyProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === 'male_standard');
  const isMale = myProfile?.gender === 'male';
  const active = myProfile?.subscription_active === true;

  const purchase = async () => {
    if (!myProfile) return;
    setBusy(true);
    setError(null);
    const result = await paymentProvider.purchase(myProfile.id);
    setBusy(false);
    if (!result.success) {
      setError('登録できませんでした。時間をおいてお試しください。');
      return;
    }
    setDone(true);
    queryClient.invalidateQueries({ queryKey: ['my-profile'] });
  };

  return (
    <Screen title="有料プラン">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="戻る"
        testID="subscription-back"
        onPress={() => router.back()}
        style={styles.backButton}
      >
        <Text style={styles.backText}>← 戻る</Text>
      </Pressable>

      {!isMale ? (
        <View style={styles.card}>
          <Text style={styles.planName}>女性は現在、無料でご利用いただけます</Text>
          <Text style={styles.description}>
            お相手探し・いいね・メッセージ・通話まで、すべての機能を無料でお使いいただけます。
          </Text>
        </View>
      ) : (
        <View style={styles.card} testID="plan-card">
          <Text style={styles.planName}>{plan?.name}</Text>
          <Text style={styles.price}>{plan?.priceLabel}</Text>
          <Text style={styles.description}>{plan?.description}</Text>

          {active || done ? (
            <View style={styles.activeBox} testID="plan-active">
              <Text style={styles.activeText}>✓ ご登録済みです</Text>
              <Text style={styles.activeSub}>メッセージの送信がご利用いただけます。</Text>
            </View>
          ) : (
            <>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <AppButton
                label="このプランに登録する"
                onPress={purchase}
                loading={busy}
                testID="plan-purchase"
              />
              <Text style={styles.mockNote}>
                ※
                開発版のため、実際のお支払いは発生しません（正式リリース時にストア決済へ切り替わります）。
              </Text>
            </>
          )}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  backButton: {
    minHeight: sizes.tapArea,
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  backText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '600',
  },
  card: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: sizes.radius,
    padding: spacing.lg,
    gap: spacing.md,
  },
  planName: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
  },
  price: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.primary,
  },
  description: {
    fontSize: fontSize.body,
    color: colors.textSub,
    lineHeight: 26,
  },
  activeBox: {
    backgroundColor: colors.primarySoft,
    borderRadius: sizes.radius,
    padding: spacing.md,
    gap: spacing.xs,
  },
  activeText: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.success,
  },
  activeSub: {
    fontSize: fontSize.body,
    color: colors.textSub,
  },
  error: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
  },
  mockNote: {
    fontSize: fontSize.small,
    color: colors.textSub,
    lineHeight: 22,
  },
});
