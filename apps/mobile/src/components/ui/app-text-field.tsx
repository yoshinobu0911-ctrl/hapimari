import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';

interface Props extends TextInputProps {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
}

export function AppTextField({ label, required, hint, error, style, ...inputProps }: Props) {
  return (
    <View style={styles.container}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}>（必須）</Text> : null}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textSub}
        style={[styles.input, inputProps.multiline && styles.multiline, style]}
        accessibilityLabel={label}
        {...inputProps}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.label,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  required: {
    color: colors.primary,
    fontWeight: '400',
  },
  input: {
    minHeight: sizes.inputHeight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.body,
    color: colors.text,
    backgroundColor: colors.background,
  },
  multiline: {
    minHeight: 120,
    paddingTop: spacing.md,
    textAlignVertical: 'top',
  },
  hint: {
    fontSize: fontSize.small,
    color: colors.textSub,
    marginTop: spacing.xs,
  },
  error: {
    fontSize: fontSize.small,
    color: colors.danger,
    marginTop: spacing.xs,
    fontWeight: '600',
  },
});
