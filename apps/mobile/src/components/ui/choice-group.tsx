import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, sizes, spacing, typography } from '@/constants/theme';

/**
 * 選択状態の目印。
 * v1 は「●」「○」「☑」「☐」の文字を本文と同じ行に混ぜていたため、
 * 端末のフォント次第で大きさも縦位置も揃わなかった。アイコンに置き換えている。
 */
function Mark({ selected, multi }: { selected: boolean; multi?: boolean }) {
  const name = multi
    ? selected
      ? 'checkbox'
      : 'square-outline'
    : selected
      ? 'radio-button-on'
      : 'radio-button-off';
  return (
    <Ionicons name={name} size={sizes.icon} color={selected ? colors.primary : colors.textMuted} />
  );
}

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
              <Mark selected={selected} />
              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
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
              <Mark selected={selected} multi />
              <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
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
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.label,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.tapArea + spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  optionSelected: {
    borderColor: colors.primary,
    // 未選択と枠線の太さを揃えて、選択時に文字位置がずれないようにする
    backgroundColor: colors.primarySoft,
  },
  optionLabel: {
    ...typography.body,
    flex: 1,
  },
  optionLabelSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
});
