import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { AppTextField } from '@/components/ui/app-text-field';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError('メールアドレスまたはパスワードが正しくありません');
      return;
    }
    router.replace('/');
  };

  return (
    <Screen title="ログイン" subtitle="ご登録のメールアドレスでログインしてください。">
      <AppTextField
        label="メールアドレス"
        required
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        testID="login-email"
      />
      <AppTextField
        label="パスワード"
        required
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        testID="login-password"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label="ログイン" onPress={submit} loading={loading} testID="login-submit" />
      <Text style={styles.note}>はじめての方は</Text>
      <AppButton
        label="新規登録はこちら"
        variant="secondary"
        onPress={() => router.replace('/(auth)/signup')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  note: {
    fontSize: fontSize.small,
    color: colors.textSub,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
});
