import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, spacing } from '@/constants/theme';

export default function Welcome() {
  const router = useRouter();
  return (
    <Screen scroll={false}>
      <View style={styles.hero}>
        <Text style={styles.logo}>ハピマリ</Text>
        <Text style={styles.catch}>人生の後半を、いっしょに歩む人と。</Text>
        <Text style={styles.description}>
          ハピマリは、女性35歳以上・男性45歳以上の方のための、再婚・パートナー探しの場です。
          {'\n'}お子さまのいる方も、初婚の方も、安心してご利用いただけます。
        </Text>
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
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    justifyContent: 'center',
  },
  logo: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  catch: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  description: {
    fontSize: fontSize.body,
    color: colors.textSub,
    lineHeight: 26,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
});
