import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, sizes, spacing, typography } from '@/constants/theme';

type Variant = 'primary' | 'secondary' | 'danger-outline' | 'quiet';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  /** ラベルの左に置くアイコン */
  icon?: keyof typeof Ionicons.glyphMap;
  /** sm は高さ48pt（SPEC下限）。主要アクションは既定の md を使う */
  size?: 'md' | 'sm';
  testID?: string;
}

/** 主要ボタン（高さ48pt以上・SPEC §2） */
export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  size = 'md',
  testID,
}: Props) {
  const isDisabled = disabled || loading;
  const fg = isDisabled
    ? variant === 'primary'
      ? // 無効時の面（#CFC7C3）に白文字だと読めないため、濃い文字色にする
        colors.neutral[700]
      : colors.disabledText
    : variant === 'primary'
      ? colors.textOnPrimary
      : variant === 'danger-outline'
        ? colors.danger
        : colors.primary;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { height: size === 'sm' ? sizes.buttonHeightSm : sizes.buttonHeight },
        variant === 'primary' && [
          styles.primary,
          {
            backgroundColor: isDisabled
              ? colors.disabled
              : pressed
                ? colors.primaryPressed
                : colors.primary,
          },
          isDisabled && styles.flat,
        ],
        variant === 'secondary' && [
          styles.secondary,
          isDisabled && { borderColor: colors.disabled },
          pressed && { backgroundColor: colors.primarySoft },
        ],
        variant === 'danger-outline' && [styles.dangerOutline, pressed && { opacity: 0.7 }],
        variant === 'quiet' && [styles.quiet, pressed && { backgroundColor: colors.surfaceSunken }],
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.textOnPrimary : colors.primary} />
      ) : (
        <View style={styles.content}>
          {icon ? <Ionicons name={icon} size={sizes.icon} color={fg} /> : null}
          <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  primary: {
    ...shadow.sm,
  },
  /** 無効状態で影が残ると押せそうに見えるため打ち消す */
  flat: {
    shadowOpacity: 0,
    elevation: 0,
  },
  secondary: {
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  dangerOutline: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  /** 枠線を持たない最も弱いボタン。画面内で重みを落としたいときに使う */
  quiet: {
    backgroundColor: 'transparent',
  },
  label: {
    ...typography.button,
  },
});
