import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, sizes, spacing, typography } from '@/constants/theme';

type Tone = 'success' | 'warning' | 'neutral' | 'primary';

interface Props {
  label: string;
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
}

const TONE: Record<Tone, { bg: string; fg: string; border: string }> = {
  success: { bg: colors.successSoft, fg: colors.success, border: '#C6DEC8' },
  warning: { bg: colors.warningSoft, fg: colors.warning, border: '#EBD5AE' },
  neutral: { bg: colors.surfaceSunken, fg: colors.textSub, border: colors.border },
  primary: { bg: colors.primarySoft, fg: colors.primary, border: colors.primaryBorder },
};

/**
 * バッジ（本人確認済み・審査待ちなど）。
 * 安心材料が視覚的に伝わることが重要（designer_brief §1.4）なため、
 * 文字だけでなくアイコンと面色をセットで持たせている。
 */
export function Badge({ label, tone = 'neutral', icon, testID }: Props) {
  const t = TONE[tone];
  return (
    <View
      testID={testID}
      style={[styles.container, { backgroundColor: t.bg, borderColor: t.border }]}
    >
      {icon ? <Ionicons name={icon} size={sizes.iconSm} color={t.fg} /> : null}
      <Text style={[styles.label, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  label: {
    ...typography.caption,
    fontWeight: '600',
  },
});
