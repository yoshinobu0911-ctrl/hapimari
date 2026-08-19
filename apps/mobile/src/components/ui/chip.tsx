import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, sizes, spacing, typography } from '@/constants/theme';

/**
 * default  … 未選択
 * selected … 自分が選んでいる
 * matched  … お相手と一致（プロフィール詳細でのみ使う）
 */
export type ChipState = 'default' | 'selected' | 'matched';

interface Props {
  label: string;
  state?: ChipState;
  onPress?: () => void;
  testID?: string;
}

/** 価値観タグのチップ（designer_brief §5 主要コンポーネント8） */
export function Chip({ label, state = 'default', onPress, testID }: Props) {
  const isMatched = state === 'matched';
  const isSelected = state === 'selected' || isMatched;

  const inner = (
    <>
      {/* 色だけに頼らず、印でも選択状態が分かるようにする */}
      {isSelected ? (
        <Ionicons
          name={isMatched ? 'checkmark-circle' : 'checkmark'}
          size={sizes.iconSm}
          color={colors.primary}
        />
      ) : null}
      <Text
        style={[styles.label, isSelected && styles.labelSelected]}
        /* 文言が長い価値観タグ（例:「家族との時間を大切にしたい」）でも省略しない */
        numberOfLines={2}
      >
        {label}
      </Text>
    </>
  );

  const containerStyle = [styles.base, isSelected ? styles.selected : styles.unselected];

  if (!onPress) {
    return (
      <View
        testID={testID}
        style={containerStyle}
        accessibilityLabel={isMatched ? `${label}（お相手と一致）` : label}
      >
        {inner}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [...containerStyle, pressed && { opacity: 0.7 }]}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizes.tapArea,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  unselected: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  selected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryBorder,
  },
  label: {
    ...typography.body,
    flexShrink: 1,
  },
  labelSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
});
