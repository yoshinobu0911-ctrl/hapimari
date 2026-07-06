import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

interface SingleProps<T extends string> {
  label?: string;
  required?: boolean;
  options: readonly ChoiceOption<T>[] | ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
}

/** 単一選択（大きなボタンを縦に並べる。ドロップダウンは中高年向けに使わない） */
export function ChoiceGroup<T extends string>({
  label,
  required,
  options,
  value,
  onChange,
}: SingleProps<T>) {
  return (
    <View style={styles.container}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}>（必須）</Text> : null}
        </Text>
      ) : null}
      <View style={styles.options}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={opt.label}
              onPress={() => onChange(opt.value)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                {selected ? '● ' : '○ '}
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface MultiProps<T extends string> {
  label?: string;
  options: readonly ChoiceOption<T>[] | ChoiceOption<T>[];
  values: T[];
  onChange: (values: T[]) => void;
}

/** 複数選択 */
export function MultiChoiceGroup<T extends string>({
  label,
  options,
  values,
  onChange,
}: MultiProps<T>) {
  const toggle = (v: T) => {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };
  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.options}>
        {options.map((opt) => {
          const selected = values.includes(opt.value);
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={opt.label}
              onPress={() => toggle(opt.value)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                {selected ? '☑ ' : '☐ '}
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** はい/いいえ の2択 */
export function YesNoChoice({
  label,
  required,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: boolean | null;
  onChange: (value: boolean) => void;
}) {
  return (
    <ChoiceGroup
      label={label}
      required={required}
      options={[
        { value: 'yes', label: 'はい' },
        { value: 'no', label: 'いいえ' },
      ]}
      value={value === null ? null : value ? 'yes' : 'no'}
      onChange={(v) => onChange(v === 'yes')}
    />
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
  options: {
    gap: spacing.sm,
  },
  option: {
    minHeight: sizes.tapArea + 4,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  optionSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primarySoft,
  },
  optionLabel: {
    fontSize: fontSize.body,
    color: colors.text,
  },
  optionLabelSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
});
