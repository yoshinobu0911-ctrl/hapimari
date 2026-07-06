import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { useAuthStore } from '@/stores/auth';

/**
 * 入口ゲート:
 *   未ログイン → (auth)/welcome
 *   ログイン済み・プロフィール未作成 → オンボーディング
 *   ログイン済み・プロフィールあり → (tabs)/discover
 */
export default function Index() {
  const { session, initialized } = useAuthStore();
  const profileQuery = useMyProfile();

  if (!initialized || (session && profileQuery.isPending)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/welcome" />;
  if (!profileQuery.data) return <Redirect href="/(auth)/onboarding/step1" />;
  return <Redirect href="/(tabs)/discover" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
