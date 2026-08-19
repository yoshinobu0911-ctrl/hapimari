import { Ionicons } from '@expo/vector-icons';
import {
  deriveSubscriptionView,
  formatJstDate,
  PAID_PLANS,
  type PaidPlan,
  type SubscriptionPlanId,
} from '@hapimari/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { AppHeader } from '@/components/ui/app-header';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  colors,
  fontSize,
  lineHeight,
  radius,
  sizes,
  spacing,
  typography,
} from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { useMySubscription } from '@/hooks/use-my-subscription';
import { confirmDialog } from '@/lib/confirm';
import { cancelSubscription, resumeSubscription, startCheckout } from '@/lib/subscription-api';

/**
 * 有料プラン（M7.2・docs/design/M7_2_payment_ui_design.md）
 *
 * - この画面はDBを一切書き換えない。有料化は Stripe Webhook（サーバー側）だけが行い、
 *   画面は subscriptions の自分の行から表示状態を導出するのみ。
 * - 決済成功の戻りURL（?checkout=success）は「確認表示のきっかけ」であって
 *   権利判定には使わない（URL直打ちで有料にはならない）。
 * - 女性は無料。マイページから導線を出していないが、直接到達した場合は案内のみ表示する。
 */

/** 表示順は 3ヶ月 → 6ヶ月 → 1ヶ月（表の推奨は3ヶ月・裏テーマは6ヶ月への誘導） */
const DISPLAY_ORDER: readonly SubscriptionPlanId[] = ['male_3m', 'male_6m', 'male_1m'];
const ORDERED_PLANS = DISPLAY_ORDER.map((id) => PAID_PLANS.find((p) => p.id === id)).filter(
  (p): p is PaidPlan => p != null,
);

/** 決済から戻った直後の反映待ちポーリング（§3.2: 2秒間隔・最大5回・エラー扱いにしない） */
const CONFIRM_INTERVAL_MS = 2000;
const CONFIRM_MAX_ATTEMPTS = 5;

/** 3桁区切り（Intl はプラットフォーム差があるため使わない） */
function yen(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

type ReturnFlow = null | 'confirming' | 'confirmed' | 'delayed' | 'canceled';

export default function Subscription() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ checkout?: string }>();
  const { data: myProfile, isPending: profilePending } = useMyProfile();
  const { data: subRow, isPending: subPending, refetch: refetchSubscription } = useMySubscription();

  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanId>('male_3m');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [returnFlow, setReturnFlow] = useState<ReturnFlow>(null);

  // 決済ページからの戻りをクエリで受け、受けたら即クエリを消す
  // （再読込・ブックマークで「確認しています」が再発火しないように。§6-9）
  useEffect(() => {
    if (params.checkout === 'success') {
      setReturnFlow('confirming');
      router.replace('/subscription');
    } else if (params.checkout === 'cancel') {
      setReturnFlow('canceled');
      router.replace('/subscription');
    }
  }, [params.checkout, router]);

  // 反映待ちポーリング。Webhookが数秒遅れても「未反映＝エラー」とは扱わない
  useEffect(() => {
    if (returnFlow !== 'confirming') return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      const { data } = await refetchSubscription();
      if (disposed) return;
      const state = deriveSubscriptionView(data ?? null, Date.now());
      if (state === 'active' || state === 'cancel_scheduled') {
        // チャットのペイウォールは profiles.subscription_active（キャッシュ）を見るため
        // ここで必ず my-profile も更新する（§8-1）
        queryClient.invalidateQueries({ queryKey: ['my-profile'] });
        setReturnFlow('confirmed');
        return;
      }
      if (attempts >= CONFIRM_MAX_ATTEMPTS) {
        setReturnFlow('delayed');
        return;
      }
      timer = setTimeout(tick, CONFIRM_INTERVAL_MS);
    };
    tick();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [returnFlow, refetchSubscription, queryClient]);

  const startPurchase = async () => {
    if (checkoutBusy) return;
    // 押下直後に無効化し、連打で決済ページを2枚作らせない（§6-1）
    setCheckoutBusy(true);
    setActionError(null);

    const result = await startCheckout(selectedPlan);
    if (!result.ok) {
      if (result.error === 'already_subscribed') {
        // 別タブ・別端末で契約済みだった。エラーではなく契約中表示へ切り替える
        await refetchSubscription();
        queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      } else {
        setActionError(result.message);
      }
      setCheckoutBusy(false);
      return;
    }

    if (Platform.OS === 'web') {
      // 同一タブで遷移する（window.open はポップアップブロックの対象）。
      // 遷移が完了するまでボタンは無効のままにしておく
      window.location.href = result.url;
      return;
    }
    // ネイティブは外部ブラウザで開く（Web先行公開のため最小対応。§9-4）
    await Linking.openURL(result.url);
    setCheckoutBusy(false);
  };

  const runCancelAction = async (resume: boolean) => {
    if (cancelBusy) return;
    setCancelBusy(true);
    setActionError(null);
    const result = resume ? await resumeSubscription() : await cancelSubscription();
    if (!result.ok) {
      setActionError(result.message);
      if (result.error === 'no_subscription' || result.error === 'already_canceled') {
        await refetchSubscription();
      }
      setCancelBusy(false);
      return;
    }
    // 関数がDBへ書き戻してから応答するため、再取得だけで最新になる（Webhookは待たない）
    await refetchSubscription();
    setCancelBusy(false);
  };

  const requestCancel = () => {
    const endLabel = formatJstDate(subRow?.current_period_end);
    confirmDialog(
      'プランの解約',
      `解約すると、次回の更新は行われません。${endLabel}まではこれまでどおりご利用いただけます。よろしいですか？`,
      () => void runCancelAction(false),
    );
  };

  const header = <AppHeader title="有料プラン" />;
  const isMale = myProfile?.gender === 'male';

  if (profilePending || (isMale && subPending)) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.content} testID="subscription-loading">
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={sizes.buttonHeight} />
        </View>
      </View>
    );
  }

  // 女性は無料（この画面への導線自体を出していない。§5.4）
  if (!isMale) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.content}>
          <Card>
            <Text style={styles.freeTitle}>女性は現在、無料でご利用いただけます</Text>
            <Text style={styles.freeBody}>
              お相手探し・いいね・メッセージ・通話まで、すべての機能を無料でお使いいただけます。
            </Text>
          </Card>
        </View>
      </View>
    );
  }

  const view = deriveSubscriptionView(subRow ?? null, Date.now());
  const currentPlan = subRow ? PAID_PLANS.find((p) => p.id === subRow.plan) : undefined;
  const endLabel = formatJstDate(subRow?.current_period_end);
  const isVerified = myProfile?.is_verified === true;

  // 決済から戻った直後の確認中は、他の操作を出さない（この間の再決済を防ぐ）
  if (returnFlow === 'confirming') {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.content} testID="subscription-confirming">
          <Banner
            tone="info"
            title="お手続きを確認しています"
            description="お支払いの反映を確認しています。このままお待ちください。"
          />
          <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
        </View>
      </View>
    );
  }

  const showPlanSelection =
    (view === 'none' || view === 'payment_trouble') && returnFlow !== 'delayed';

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        {returnFlow === 'confirmed' ? (
          <Banner
            testID="subscription-confirmed"
            tone="success"
            title="ご登録ありがとうございます"
            description="メッセージの送信がご利用いただけるようになりました。"
          />
        ) : null}

        {returnFlow === 'canceled' ? (
          <Banner
            testID="subscription-checkout-canceled"
            tone="info"
            title="お手続きは完了していません"
            description="決済は行われておらず、料金は発生していません。"
          />
        ) : null}

        {returnFlow === 'delayed' ? (
          <>
            <Banner
              testID="subscription-delayed"
              tone="info"
              title="反映までに時間がかかっています"
              description="お支払いの反映まで数分かかる場合があります。しばらくしてから下のボタンでご確認ください。"
            />
            <AppButton
              label="最新の状態を確認する"
              variant="secondary"
              onPress={() => setReturnFlow('confirming')}
              testID="subscription-refresh"
            />
          </>
        ) : null}

        {view === 'payment_trouble' ? (
          <Banner
            testID="subscription-payment-trouble"
            tone="warning"
            title="お支払いが確認できませんでした"
            description="カードの有効期限・ご利用残高をご確認ください。ご利用を続けるには、あらためてプランにご登録ください。"
          />
        ) : null}

        {actionError ? (
          <Text style={styles.error} testID="subscription-error">
            {actionError}
          </Text>
        ) : null}

        {view === 'active' ? (
          <>
            <Card testID="plan-active">
              <Text style={styles.currentLabel}>ご利用中: {currentPlan?.name ?? '有料プラン'}</Text>
              <Text style={styles.currentDate}>次回更新日: {endLabel}</Text>
              {currentPlan ? (
                <Text style={styles.currentPrice}>
                  月あたり {yen(currentPlan.monthlyEquivalent)}円（総額 {yen(currentPlan.amount)}
                  円）
                </Text>
              ) : null}
            </Card>
            <AppButton
              label="プランを解約する"
              variant="secondary"
              size="sm"
              onPress={requestCancel}
              loading={cancelBusy}
              testID="plan-cancel"
            />
            <Text style={styles.note}>
              解約しても、{endLabel}まではこれまでどおりご利用いただけます。
            </Text>
          </>
        ) : null}

        {view === 'cancel_scheduled' ? (
          <>
            <Card testID="plan-cancel-scheduled">
              <Text style={styles.currentLabel}>ご利用中: {currentPlan?.name ?? '有料プラン'}</Text>
              <Text style={styles.currentDateEnd}>{endLabel}で終了します</Text>
            </Card>
            <AppButton
              label="解約を取り消す"
              onPress={() => void runCancelAction(true)}
              loading={cancelBusy}
              testID="plan-resume"
            />
            <Text style={styles.note}>{endLabel}までは、これまでどおりご利用いただけます。</Text>
          </>
        ) : null}

        {showPlanSelection ? (
          !isVerified ? (
            <>
              <Banner
                testID="subscription-need-verification"
                tone="warning"
                title="プランのご登録には、本人確認の完了が必要です"
                description="ご本人確認が完了するまで、メッセージの送信はできません。お手続きはすぐに終わります。"
              />
              <AppButton
                label="本人確認に進む"
                onPress={() => router.push('/upload')}
                testID="subscription-to-verification"
              />
            </>
          ) : (
            <>
              <View style={styles.planList} accessibilityRole="radiogroup">
                {ORDERED_PLANS.map((plan) => {
                  const selected = plan.id === selectedPlan;
                  return (
                    <Pressable
                      key={plan.id}
                      testID={`plan-${plan.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${plan.name} 月あたり${yen(plan.monthlyEquivalent)}円 総額${yen(plan.amount)}円 ${plan.months}ヶ月ごとに自動更新${plan.recommended ? ' おすすめ' : ''}`}
                      onPress={() => setSelectedPlan(plan.id)}
                      style={[styles.planCard, selected && styles.planCardSelected]}
                    >
                      <View style={styles.planHeader}>
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={sizes.icon}
                          color={selected ? colors.primary : colors.textMuted}
                        />
                        <Text style={[styles.planName, selected && styles.planNameSelected]}>
                          {plan.name}
                        </Text>
                        {plan.recommended ? <Badge label="おすすめ" tone="primary" /> : null}
                      </View>
                      <Text style={styles.planMonthly}>
                        月あたり {yen(plan.monthlyEquivalent)}円
                      </Text>
                      <Text style={styles.planTotal}>
                        総額 {yen(plan.amount)}円（{plan.months}ヶ月ごとに自動更新）
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <AppButton
                label="このプランで進む"
                onPress={() => void startPurchase()}
                loading={checkoutBusy}
                testID="plan-purchase"
              />

              {/* 以下4行は特商法の法定表示に直結する。省略・要約しないこと（§3.1） */}
              <View style={styles.legalNotes}>
                <Text style={styles.legalNote}>・料金はすべて税込です。</Text>
                <Text style={styles.legalNote}>
                  ・契約期間の満了日に自動更新され、同日に決済されます。
                </Text>
                <Text style={styles.legalNote}>
                  ・解約はこの画面からいつでも手続きできます（次回更新日の24時間前まで）。
                </Text>
                <Text style={styles.legalNote}>・お客様都合による返金・中途解約はできません。</Text>
              </View>
              {/*
                特商法表記・利用規約・プライバシーポリシーへのリンクは、BYYコーポレート
                サイト側のページ公開後にここへ追加する（2026-08-19 オーナー判断・保留）。
                公開前の設置は法定要件（docs/launch_checklist.md ②-11）。
              */}
            </>
          )
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
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  spinner: {
    marginTop: spacing.lg,
  },
  freeTitle: {
    ...typography.heading,
    marginBottom: spacing.sm,
  },
  freeBody: {
    ...typography.body,
    color: colors.textSub,
  },
  error: {
    ...typography.bodyStrong,
    color: colors.danger,
  },
  planList: {
    gap: spacing.sm,
  },
  planCard: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.xs,
  },
  planCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySubtle,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  planName: {
    ...typography.heading,
    flexShrink: 1,
  },
  planNameSelected: {
    color: colors.primary,
  },
  planMonthly: {
    fontSize: fontSize.title,
    lineHeight: lineHeight.title,
    fontWeight: '700',
    color: colors.text,
  },
  planTotal: {
    ...typography.caption,
  },
  legalNotes: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  legalNote: {
    ...typography.caption,
  },
  currentLabel: {
    ...typography.heading,
    marginBottom: spacing.xs,
  },
  currentDate: {
    ...typography.bodyStrong,
    marginBottom: spacing.xs,
  },
  currentDateEnd: {
    ...typography.bodyStrong,
    color: colors.warning,
    marginBottom: spacing.xs,
  },
  currentPrice: {
    ...typography.caption,
  },
  note: {
    ...typography.caption,
  },
});
