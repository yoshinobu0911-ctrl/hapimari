import { calcAge } from '@hapimari/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ProfilePhoto } from '@/components/profile-photo';
import { AppButton } from '@/components/ui/app-button';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { confirmDialog, infoDialog } from '@/lib/confirm';
import { supabase } from '@/lib/supabase';

const MARITAL_LABEL: Record<string, string> = {
  unmarried: '未婚',
  divorced: '離婚',
  widowed: '死別',
};

export default function MyPage() {
  const router = useRouter();
  const { data: profile } = useMyProfile();

  if (!profile) return null;

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

      <View style={styles.badges}>
        <Text style={[styles.badgeItem, profile.is_verified ? styles.badgeOn : styles.badgeOff]}>
          {profile.is_verified ? '✓ 本人確認済み' : '本人確認 未提出'}
        </Text>
        <Text
          style={[styles.badgeItem, profile.income_verified ? styles.badgeOn : styles.badgeOff]}
        >
          {profile.income_verified ? '✓ 収入証明済み' : '収入証明 未提出（任意）'}
        </Text>
        <Text
          style={[
            styles.badgeItem,
            profile.single_cert_verified ? styles.badgeOn : styles.badgeOff,
          ]}
        >
          {profile.single_cert_verified ? '✓ 独身証明済み' : '独身証明 未提出（任意）'}
        </Text>
      </View>
      {!profile.is_verified ? (
        <Text style={styles.verifyNote}>※本人確認が完了するまでメッセージの送信はできません。</Text>
      ) : null}
      <View style={styles.verifyButton}>
        <AppButton
          label="証明書類を提出する"
          variant={profile.is_verified ? 'secondary' : 'primary'}
          onPress={() => router.push('/upload')}
          testID="mypage-verification"
        />
      </View>

      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      <View style={styles.actions}>
        <AppButton
          label="プロフィールを編集する"
          onPress={() => router.push('/profile-edit')}
          testID="mypage-edit"
        />
        <AppButton
          label="有料プランについて"
          variant="secondary"
          onPress={() => router.push('/subscription')}
          testID="mypage-subscription"
        />
        <AppButton
          label="ブロックしたユーザー"
          variant="secondary"
          onPress={() => router.push('/settings/blocked')}
          testID="mypage-blocked"
        />
        <AppButton label="ログアウト" variant="secondary" onPress={logout} testID="mypage-logout" />
        <AppButton
          label="退会について"
          variant="danger-outline"
          onPress={withdraw}
          testID="mypage-withdraw"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  photo: {
    width: 96,
    height: 128,
    borderRadius: sizes.radius,
    backgroundColor: colors.surface,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoPlaceholderText: {
    fontSize: fontSize.small,
    color: colors.textSub,
  },
  profileInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  name: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    fontSize: fontSize.body,
    color: colors.textSub,
  },
  badges: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  badgeItem: {
    fontSize: fontSize.body,
  },
  badgeOn: {
    color: colors.badge,
    fontWeight: '600',
  },
  badgeOff: {
    color: colors.textSub,
  },
  verifyNote: {
    fontSize: fontSize.small,
    color: colors.danger,
    lineHeight: 24,
    marginBottom: spacing.md,
  },
  verifyButton: {
    marginBottom: spacing.lg,
  },
  bio: {
    fontSize: fontSize.body,
    color: colors.text,
    lineHeight: 26,
    marginBottom: spacing.lg,
  },
  actions: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
});
