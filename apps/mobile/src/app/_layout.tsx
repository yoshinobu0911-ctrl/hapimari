import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { colors } from '@/constants/theme';
import { startAuthListener, useAuthStore } from '@/stores/auth';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

// 白基調・ライトテーマ固定（SPEC §2）
const appTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.background,
    text: colors.text,
    border: colors.border,
  },
};

export default function RootLayout() {
  const initialized = useAuthStore((s) => s.initialized);

  useEffect(() => {
    startAuthListener();
  }, []);

  useEffect(() => {
    if (initialized) SplashScreen.hideAsync();
  }, [initialized]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={appTheme}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
