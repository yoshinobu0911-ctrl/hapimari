import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/constants/theme';

interface Props {
  /** 現在のステップ（1始まり） */
  current: number;
  total: number;
}

/**
 * オンボーディングの進捗表示。
 * v1 は画面タイトルの「（1/4）」だけが手がかりで、
 * あと何回入力すれば終わるのかが直感的に分からなかった。
 * 数字と帯の両方で示す（色だけに頼らない）。
 */
export function StepProgress({ current, total }: Props) {
  const steps = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={`全${total}ステップ中 ${current}ステップ目`}
    >
      <View style={styles.bars}>
        {steps.map((step) => (
          <View key={step} style={[styles.bar, step <= current && styles.barDone]} />
        ))}
      </View>
      <Text style={styles.label}>
        あと{Math.max(total - current, 0)}ステップ（{current}/{total}）
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  bars: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  bar: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
  },
  barDone: {
    backgroundColor: colors.primary,
  },
  label: {
    ...typography.caption,
  },
});
