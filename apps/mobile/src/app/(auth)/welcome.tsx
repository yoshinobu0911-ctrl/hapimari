import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { Screen } from '@/components/ui/screen';
import { colors, sizes, spacing, typography } from '@/constants/theme';

/** 入会前の不安（詐欺・遊び目的）に先回りして答える3点（designer_brief §1.4） */
const TRUST_POINTS: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { icon: 'shield-checkmark-outline', label: '本人確認をしてから、やりとりがはじまります' },
  { icon: 'people-outline', label: '大人世代だけが集まる場です' },
  { icon: 'chatbubble-ellipses-outline', label: '気になることは、いつでも運営に通報できます' },
];

/**
 * ウェルカム画面。
 * v1 は画面中央に大きな空白が空き、キャッチコピーが「人と。」で不自然に折り返していた。
 * v2 では改行位置を明示し、空いていた領域に安心材料を置いて意味のある面にしている。
 */
export default function Welcome() {
  const router = useRouter();
  return (
    <Screen scroll={false}>
      <View style={styles.hero}>
        <View style={styles.logoMark}>
          <Ionicons name="heart" size={30} color={colors.primary} />
        </View>
        <Text style={styles.logo}>ハピマリ</Text>
        {/* 折り返し位置を機械任せにせず、意味の切れ目で改行する */}
        <Text style={styles.catch}>人生の後半を、{'\n'}いっしょに歩む人と。</Text>
        <View style={styles.rule} />
        <Text style={styles.description}>
          ハピマリは、大人世代のためのまじめなパートナー探しの場です。
          {'\n'}はじめての方も、再びの方も、あなたのペースで、安心して。
        </Text>
      </View>

      <View style={styles.trust}>
        {TRUST_POINTS.map((point) => (
          <View key={point.label} style={styles.trustRow}>
            <Ionicons name={point.icon} size={sizes.icon} color={colors.primary} />
            <Text style={styles.trustLabel}>{point.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <AppButton
          label="はじめる（無料登録）"
          testID="welcome-signup"
          onPress={() => router.push('/(auth)/signup')}
        />
        <AppButton
          label="ログイン"
          variant="secondary"
          testID="welcome-login"
          onPress={() => router.push('/(auth)/login')}
        />
        <Text style={styles.note}>ご登録は35歳以上の方が対象です</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logo: {
    ...typography.display,
    color: colors.primary,
    letterSpacing: 2,
    textAlign: 'center',
  },
  catch: {
    ...typography.headingLg,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  rule: {
    width: 48,
    height: 2,
    backgroundColor: colors.primaryBorder,
    marginVertical: spacing.lg,
  },
  /**
   * 中央揃えにすると両端が不揃いに折り返して読みにくいため左揃えにしている。
   * 中央揃えを保つのは、折り返し位置を自分で決められるロゴとキャッチコピーだけ。
   */
  description: {
    ...typography.body,
    color: colors.textSub,
    alignSelf: 'stretch',
  },
  trust: {
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: colors.primarySubtle,
    borderRadius: sizes.radius,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  trustLabel: {
    ...typography.caption,
    color: colors.text,
    flex: 1,
  },
  actions: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  note: {
    ...typography.caption,
    textAlign: 'center',
  },
});
