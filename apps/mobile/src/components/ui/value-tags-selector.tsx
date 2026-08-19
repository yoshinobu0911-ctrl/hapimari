import { valueTagsByCategory } from '@hapimari/shared';
import { StyleSheet, Text, View } from 'react-native';
import { Chip } from '@/components/ui/chip';
import { colors, spacing, typography } from '@/constants/theme';

interface Props {
  values: string[];
  onChange: (values: string[]) => void;
}

/**
 * 価値観タグの選択（カテゴリごとのチップ・複数選択）。
 * v2 でチップの実装を共通の Chip に寄せた。
 * v1 はここだけ独自のチップを持っていて、プロフィール詳細の価値観タグと
 * 角丸・枠線の太さ・選択時の見え方が微妙に違っていた。
 */
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
            {group.tags.map((tag) => (
              <Chip
                key={tag.id}
                label={tag.label}
                state={values.includes(tag.id) ? 'selected' : 'default'}
                onPress={() => toggle(tag.id)}
              />
            ))}
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
    marginBottom: spacing.lg,
  },
  groupLabel: {
    ...typography.label,
    color: colors.textSub,
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
