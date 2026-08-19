import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, sizes, spacing, typography } from '@/constants/theme';

interface Props {
  label: string;
  /** 右側に出す補足（「未提出」など） */
  value?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  /** 退会・ログアウトなど、押すと後戻りしにくい項目 */
  tone?: 'default' | 'danger';
  testID?: string;
}

/**
 * 設定リストの1行。
 * v1 のマイページは同じ太さの枠線ボタンが4つ縦に並び、
 * 「ブロック一覧」と「退会」が同じ重みに見えていた（SPEC「1画面1主要アクション」と矛盾）。
 * 主要アクション以外はこの行型に落とし、視覚的な重みを下げている。
 */
export function ListItem({ label, value, icon, onPress, tone = 'default', testID }: Props) {
  const fg = tone === 'danger' ? colors.danger : colors.text;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label} ${value}` : label}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={sizes.icon}
          color={tone === 'danger' ? colors.danger : colors.textSub}
        />
      ) : null}
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {onPress ? (
        <Ionicons name="chevron-forward" size={sizes.icon} color={colors.textMuted} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.tapArea + spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  pressed: {
    backgroundColor: colors.surfaceSunken,
  },
  label: {
    ...typography.body,
    flex: 1,
  },
  value: {
    ...typography.caption,
  },
});
