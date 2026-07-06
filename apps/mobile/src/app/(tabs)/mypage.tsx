import { calcAge } from '@hapimari/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
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

  const withdraw = () => {
    confirmDialog(
      '退会について',
      '退会するとプロフィールが非表示になり、マッチやメッセージが見られなくなります。本当に退会をご検討ですか？',
      () =>
        infoDialog(
          '退会手続き',
          '退会手続きは現在準備中です。お急ぎの場合は運営までご連絡ください。',
        ),
    );
  };

  const photo = profile.photo_urls?.[0];

  return (
    <Screen title="マイページ">
      <View style={styles.profileRow}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Text style={styles.photoPlaceholderText}>写真なし</Text>
          </View>
        )}
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
        <Text style={styles.verifyNote}>
          ※本人確認が完了するまでメッセージの送信はできません。（書類提出の受付は準備中です）
        </Text>
      ) : null}

      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      <View style={styles.actions}>
        <AppButton
          label="プロフィールを編集する"
          onPress={() => router.push('/profile-edit')}
          testID="mypage-edit"
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
