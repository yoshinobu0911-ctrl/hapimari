import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, fontSize, sizes } from '@/constants/theme';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger-outline';
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

/** 主要ボタン（高さ48pt以上・SPEC §2） */
export function AppButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  testID,
}: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && {
          backgroundColor: isDisabled
            ? colors.disabled
            : pressed
              ? colors.primaryPressed
              : colors.primary,
        },
        variant === 'secondary' && [
          styles.secondary,
          pressed && { backgroundColor: colors.primarySoft },
        ],
        variant === 'danger-outline' && [styles.dangerOutline, pressed && { opacity: 0.7 }],
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.textOnPrimary : colors.primary} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'primary' && { color: colors.textOnPrimary },
            variant === 'secondary' && { color: colors.primary },
            variant === 'danger-outline' && { color: colors.danger },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: sizes.buttonHeight,
    borderRadius: sizes.radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
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
  label: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
});
