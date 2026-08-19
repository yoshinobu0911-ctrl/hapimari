import { calcAge, deriveSubscriptionView, formatJstDate } from '@hapimari/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ProfilePhoto } from '@/components/profile-photo';
import { AppButton } from '@/components/ui/app-button';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { ListItem } from '@/components/ui/list-item';
import { Screen } from '@/components/ui/screen';
import { Section } from '@/components/ui/section';
import { colors, radius, sizes, spacing, typography } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { useMySubscription } from '@/hooks/use-my-subscription';
import { confirmDialog, infoDialog } from '@/lib/confirm';
import { supabase } from '@/lib/supabase';

const MARITAL_LABEL: Record<string, string> = {
  unmarried: '未婚',
  divorced: '離婚',
  widowed: '死別',
};

/**
 * マイページ。
 * v1 は同じ太さの枠線ボタンが5つ縦に並び、「ブロック一覧」と「退会」が同じ重みに見えていた
 * （SPEC §2「1画面につき主要アクションは1つ」と矛盾）。
 * v2 では主要アクションを「プロフィールを編集する」1つに絞り、
 * 残りは設定リストの行に落として視覚的な重みを下げている。
 */
export default function MyPage() {
  const router = useRouter();
  const { data: profile } = useMyProfile();
  const { data: subscription } = useMySubscription();

  if (!profile) return null;

  // 有料プランの行は男性のみ（女性は無料のため導線ごと出さない。M7.2 §5.4）
  const subscriptionView = deriveSubscriptionView(subscription ?? null, Date.now());
  const subscriptionValue =
    subscriptionView === 'active'
      ? `次回更新 ${formatJstDate(subscription?.current_period_end)}`
      : subscriptionView === 'cancel_scheduled'
        ? `${formatJstDate(subscription?.current_period_end)}で終了`
        : subscriptionView === 'payment_trouble'
          ? 'お支払いの確認が必要'
          : undefined;

  const logout = () => {
    confirmDialog('ログアウト', 'ログアウトしますか？', () => {
      supabase.auth.signOut();
    });
  };

  // M6 A5: 退会（ソフトデリート・2段階確認）
  const withdraw = () => {
    confirmDialog(
      '退会について',
      '退会するとプロフィールが非表示になり、お相手からあなたが見えなくなります。退会手続きに進みますか？',
      () =>
        confirmDialog(
          '最終確認',
          '本当に退会しますか？この操作のあと、自動的にログアウトします。',
          async () => {
            const { error } = await supabase.rpc('withdraw_account');
            if (error) {
              infoDialog('エラー', '退会処理に失敗しました。時間をおいてお試しください。');
              return;
            }
            infoDialog('退会しました', 'ご利用ありがとうございました。');
            supabase.auth.signOut();
          },
        ),
    );
  };

  return (
    <Screen title="マイページ">
      <View style={styles.profileRow}>
        <ProfilePhoto
          path={profile.photo_urls?.[0]}
          style={styles.photo}
          placeholderStyle={styles.photoPlaceholder}
          placeholderTextStyle={styles.photoPlaceholderText}
        />
        <View style={styles.profileInfo}>
          <Text style={styles.name} testID="mypage-nickname">
            {profile.nickname}
          </Text>
          <Text style={styles.meta}>
            {calcAge(profile.birth_date)}歳・{profile.prefecture}
            {profile.city ? ` ${profile.city}` : ''}
          </Text>
          <Text style={styles.meta}>
            {MARITAL_LABEL[profile.marital_history] ?? ''}
            {profile.has_children ? '・子どもあり' : ''}
          </Text>
        </View>
      </View>

      <Section title="証明とバッジ">
        <View style={styles.badges}>
          <Badge
            label={profile.is_verified ? '本人確認済み' : '本人確認 未提出'}
            tone={profile.is_verified ? 'success' : 'neutral'}
            icon={profile.is_verified ? 'shield-checkmark' : 'shield-outline'}
          />
          <Badge
            label={profile.income_verified ? '収入証明済み' : '収入証明 未提出（任意）'}
            tone={profile.income_verified ? 'success' : 'neutral'}
            icon={profile.income_verified ? 'checkmark-circle' : 'ellipse-outline'}
          />
          <Badge
            label={profile.single_cert_verified ? '独身証明済み' : '独身証明 未提出（任意）'}
            tone={profile.single_cert_verified ? 'success' : 'neutral'}
            icon={profile.single_cert_verified ? 'checkmark-circle' : 'ellipse-outline'}
          />
        </View>

        {!profile.is_verified ? (
          <View style={styles.banner}>
            <Banner
              tone="warning"
              title="本人確認がまだ完了していません"
              description="本人確認が完了するまで、メッセージの送信はできません。"
            />
          </View>
        ) : null}

        <View style={styles.verifyButton}>
          <AppButton
            label="証明書類を提出する"
            variant="secondary"
            size="sm"
            icon="document-text-outline"
            onPress={() => router.push('/upload')}
            testID="mypage-verification"
          />
        </View>
      </Section>

      {profile.bio ? (
        <Section title="自己紹介">
          <Text style={styles.bio}>{profile.bio}</Text>
        </Section>
      ) : null}

      {/* この画面の主要アクションはこれ1つ（SPEC §2） */}
      <View style={styles.primaryAction}>
        <AppButton
          label="プロフィールを編集する"
          onPress={() => router.push('/profile-edit')}
          testID="mypage-edit"
        />
      </View>

      <Section title="設定" divided>
        <View style={styles.list}>
          {profile.gender === 'male' ? (
            <ListItem
              label={subscriptionView === 'none' ? '有料プランについて' : '有料プラン'}
              value={subscriptionValue}
              icon="card-outline"
              onPress={() => router.push('/subscription')}
              testID="mypage-subscription"
            />
          ) : null}
          <ListItem
            label="ブロックしたユーザー"
            icon="ban-outline"
            onPress={() => router.push('/settings/blocked')}
            testID="mypage-blocked"
          />
          <ListItem
            label="ログアウト"
            icon="log-out-outline"
            onPress={logout}
            testID="mypage-logout"
          />
          <ListItem
            label="退会について"
            icon="person-remove-outline"
            tone="danger"
            onPress={withdraw}
            testID="mypage-withdraw"
          />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  photo: {
    width: sizes.avatarLg,
    height: sizes.avatarLg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoPlaceholderText: {
    ...typography.caption,
  },
  profileInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  name: {
    ...typography.headingLg,
  },
  meta: {
    ...typography.body,
    color: colors.textSub,
  },
  badges: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  banner: {
    marginTop: spacing.md,
  },
  verifyButton: {
    marginTop: spacing.md,
  },
  bio: {
    ...typography.body,
  },
  primaryAction: {
    marginBottom: spacing.xl,
  },
  /** 設定リストは画面の左右いっぱいまで敷く（Screen の左右余白を打ち消す） */
  list: {
    marginHorizontal: -spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
});
