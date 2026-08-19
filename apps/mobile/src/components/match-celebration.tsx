import { Ionicons } from '@expo/vector-icons';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { ProfilePhoto } from '@/components/profile-photo';
import { AppButton } from '@/components/ui/app-button';
import { colors, radius, shadow, sizes, spacing, typography } from '@/constants/theme';

interface Props {
  visible: boolean;
  /** お相手の表示名 */
  partnerName: string;
  /** お相手の写真パス（photo_urls[0]） */
  partnerPhotoPath: string | null | undefined;
  /** 自分の写真パス */
  myPhotoPath: string | null | undefined;
  /** 「メッセージを送る」 */
  onOpenChat: () => void;
  /** 「あとで」・背景タップはなし（誤タップで演出を閉じない） */
  onClose: () => void;
}

/**
 * マッチ成立の演出（progress.md TODO・designer_brief §3.3）。
 * v1 は素の confirmDialog（OS標準ダイアログ）だった。
 * 派手な装飾・アニメーションの禁止（designer_brief §7.2: ゲーム風・ギラつきNG）に従い、
 * フェード表示＋写真2枚＋落ち着いた文面のみで構成する。
 * 外部デザイナー納品時（竹プラン §3.3）に差し替えられる想定の暫定実装。
 */
export function MatchCelebration({
  visible,
  partnerName,
  partnerPhotoPath,
  myPhotoPath,
  onOpenChat,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card} testID="match-celebration">
          <View style={styles.photos}>
            <ProfilePhoto
              path={myPhotoPath}
              style={styles.photo}
              placeholderStyle={styles.photoPlaceholder}
              placeholderTextStyle={styles.photoPlaceholderText}
            />
            <View style={styles.heart}>
              <Ionicons name="heart" size={sizes.iconLg} color={colors.primary} />
            </View>
            <ProfilePhoto
              path={partnerPhotoPath}
              style={styles.photo}
              placeholderStyle={styles.photoPlaceholder}
              placeholderTextStyle={styles.photoPlaceholderText}
            />
          </View>

          <Text style={styles.title}>マッチが成立しました</Text>
          <Text style={styles.body}>
            {partnerName}さんとお互いに「いいね」を送り合いました。{'\n'}
            まずはあいさつのメッセージを送ってみましょう。
          </Text>

          <View style={styles.actions}>
            <AppButton
              label="メッセージを送る"
              onPress={onOpenChat}
              testID="match-celebration-chat"
            />
            <AppButton
              label="あとで"
              variant="quiet"
              onPress={onClose}
              testID="match-celebration-later"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    ...shadow.lg,
  },
  photos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  photo: {
    width: sizes.avatarLg,
    height: sizes.avatarLg,
    borderRadius: sizes.avatarLg / 2,
    borderWidth: 2,
    borderColor: colors.primaryBorder,
  },
  photoPlaceholder: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: {
    ...typography.caption,
  },
  heart: {
    width: sizes.tapArea,
    height: sizes.tapArea,
    borderRadius: sizes.tapArea / 2,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.headingLg,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSub,
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
