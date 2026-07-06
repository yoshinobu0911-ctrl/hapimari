import { Redirect, Stack } from 'expo-router';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth';

export default function OnboardingLayout() {
  const { session, initialized } = useAuthStore();

  // 未ログインでオンボーディングには入れない
  if (initialized && !session) return <Redirect href="/(auth)/welcome" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        // 途中離脱で入力が飛ばないよう戻るジェスチャーは許可、ヘッダーは各画面で表示
      }}
    />
  );
}
