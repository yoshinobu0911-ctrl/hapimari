import { valueTagsByCategory } from '@hapimari/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';

interface Props {
  values: string[];
  onChange: (values: string[]) => void;
}

/** 価値観タグの選択（カテゴリごとのチップ・複数選択） */
export function ValueTagsSelector({ values, onChange }: Props) {
  const toggle = (id: string) => {
    onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  };

  return (
    <View style={styles.container}>
      {valueTagsByCategory().map((group) => (
        <View key={group.key} style={styles.group}>
          <Text style={styles.groupLabel}>{group.label}</Text>
          <View style={styles.chips}>
            {group.tags.map((tag) => {
              const selected = values.includes(tag.id);
              return (
                <Pressable
                  key={tag.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={tag.label}
                  onPress={() => toggle(tag.id)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {selected ? '✓ ' : ''}
                    {tag.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  group: {
    marginBottom: spacing.md,
  },
  groupLabel: {
    fontSize: fontSize.label,
    fontWeight: '700',
    color: colors.textSub,
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: sizes.tapArea,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: sizes.tapArea / 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  chipSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primarySoft,
  },
  chipLabel: {
    fontSize: fontSize.body,
    color: colors.text,
  },
  chipLabelSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
});
