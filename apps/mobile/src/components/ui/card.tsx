import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, shadow, spacing } from '@/constants/theme';

interface Props {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** 内側の余白を自前で持つ場合は false（写真を端まで敷くカードなど） */
  padded?: boolean;
  testID?: string;
}

/**
 * 汎用カード。枠線＋ごく弱い影で背景から浮かせる。
 * 「派手な装飾の禁止」（designer_brief §4-5）に触れない強さに留めている。
 */
export function Card({ children, onPress, accessibilityLabel, padded = true, testID }: Props) {
  const style = [styles.card, padded && styles.padded];

  if (!onPress) {
    return (
      <View testID={testID} style={style}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [...style, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
    ...shadow.sm,
  },
  padded: {
    padding: spacing.md,
  },
  pressed: {
    backgroundColor: colors.surface,
  },
});
