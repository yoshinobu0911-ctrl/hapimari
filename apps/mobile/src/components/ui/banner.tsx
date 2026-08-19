import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, sizes, spacing, typography } from '@/constants/theme';

type Tone = 'primary' | 'info' | 'warning' | 'success' | 'danger';

interface Props {
  tone?: Tone;
  title: string;
  /** 補足文。1行の帯で足りないときだけ渡す */
  description?: string;
  /** 押せる場合。矢印が表示される */
  onPress?: () => void;
  testID?: string;
}

const TONE: Record<
  Tone,
  { bg: string; border: string; fg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  primary: {
    bg: colors.primarySoft,
    border: colors.primaryBorder,
    fg: colors.primary,
    icon: 'heart-circle-outline',
  },
  info: {
    bg: colors.infoSoft,
    border: '#C9DCE8',
    fg: colors.info,
    icon: 'information-circle-outline',
  },
  warning: {
    bg: colors.warningSoft,
    border: '#EBD5AE',
    fg: colors.warning,
    icon: 'warning-outline',
  },
  success: {
    bg: colors.successSoft,
    border: '#C6DEC8',
    fg: colors.success,
    icon: 'checkmark-circle-outline',
  },
  danger: {
    bg: colors.dangerSoft,
    border: '#E8C4BF',
    fg: colors.danger,
    icon: 'alert-circle-outline',
  },
};

/**
 * お知らせ帯（デート誘導・詐欺注意・審査状態）。
 * v1 ではデート誘導バナーが絵文字＋テキストの直書きで、文言が長いと矢印だけが
 * 2行目に落ちてレイアウトが崩れていた。アイコンと矢印を左右に固定して解消している。
 */
export function Banner({ tone = 'info', title, description, onPress, testID }: Props) {
  const t = TONE[tone];

  const content = (
    <>
      <Ionicons name={t.icon} size={sizes.icon} color={t.fg} style={styles.icon} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: t.fg }]}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {onPress ? (
        <Ionicons name="chevron-forward" size={sizes.icon} color={t.fg} style={styles.chevron} />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        testID={testID}
        style={[styles.container, { backgroundColor: t.bg, borderColor: t.border }]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={description ? `${title} ${description}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: t.bg, borderColor: t.border },
        pressed && { opacity: 0.75 },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    minHeight: sizes.tapArea,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  icon: {
    marginTop: 2,
  },
  body: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.bodyStrong,
  },
  description: {
    ...typography.caption,
  },
  chevron: {
    marginTop: 2,
  },
});
