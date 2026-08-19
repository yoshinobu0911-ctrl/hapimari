import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, sizes, spacing, typography } from '@/constants/theme';

interface Props {
  title?: string;
  /** 戻る導線を出すか */
  showBack?: boolean;
  /** 既定は router.back()。差し替えたいときだけ渡す */
  onBack?: () => void;
  /** タイトルを押せるようにする（トークからお相手のプロフィールを開く等） */
  onTitlePress?: () => void;
  /** 右端のアクション（…メニュー等）。アイコン2つまで */
  right?: ReactNode;
  /** 下線を引くか。スクロールする画面では引いて境界を示す */
  bordered?: boolean;
}

/**
 * タイトルの左右に確保する領域。
 * 右にアイコンを2つ置いても中央のタイトルがずれないよう、左右で同じ幅を空けている。
 */
const SIDE_SLOT = sizes.tapArea * 2 + spacing.sm;

/**
 * 全画面共通のヘッダー。
 * v1 では画面ごとに「← 戻る」を手書きしていてタイトル位置も揃っていなかったため統一した。
 * 戻るボタンはタップ領域44pt以上を確保している（SPEC §2）。
 */
export function AppHeader({
  title,
  showBack = true,
  onBack,
  onTitlePress,
  right,
  bordered = true,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) router.back();
  };

  const titleText = (
    <Text style={styles.title} numberOfLines={1}>
      {title}
    </Text>
  );

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top },
        bordered && { borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.row}>
        {/* タイトルは絶対配置で常に画面中央。左右のボタン数に影響されない */}
        <View style={styles.titleSlot} pointerEvents="box-none">
          {onTitlePress ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={title}
              onPress={onTitlePress}
              style={styles.titleButton}
            >
              {titleText}
            </Pressable>
          ) : (
            titleText
          )}
        </View>

        <View style={styles.side}>
          {showBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="戻る"
              onPress={handleBack}
              hitSlop={8}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-back" size={sizes.iconLg} color={colors.text} />
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.side, styles.sideRight]}>{right}</View>
      </View>
    </View>
  );
}

/** ヘッダー右端に置く円形アイコンボタン */
export function HeaderIconButton({
  name,
  label,
  onPress,
  testID,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Ionicons name={name} size={sizes.icon} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    borderBottomColor: colors.borderSubtle,
  },
  row: {
    height: sizes.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  titleSlot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: SIDE_SLOT,
    right: SIDE_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleButton: {
    height: sizes.tapArea,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  title: {
    ...typography.heading,
    textAlign: 'center',
  },
  side: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: sizes.tapArea,
  },
  sideRight: {
    justifyContent: 'flex-end',
  },
  iconButton: {
    width: sizes.tapArea,
    height: sizes.tapArea,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: sizes.tapArea / 2,
  },
  pressed: {
    backgroundColor: colors.surfaceSunken,
  },
});
