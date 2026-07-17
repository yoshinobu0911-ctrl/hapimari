import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { AppTextField } from '@/components/ui/app-text-field';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export default function Signup() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.includes('@')) {
      setError('メールアドレスの形式が正しくありません');
      return;
    }
    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください');
      return;
    }
    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (signUpError) {
      setError(
        signUpError.message.includes('already registered')
          ? 'このメールアドレスは既に登録されています'
          : `登録に失敗しました: ${signUpError.message}`,
      );
      return;
    }
    // ローカル環境はメール確認なしで即セッションが発行される
    router.replace('/(auth)/onboarding/step1');
  };

  return (
    <Screen title="新規登録" subtitle="メールアドレスとパスワードをご入力ください。">
      <AppTextField
        label="メールアドレス"
        required
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="例: hanako@example.com"
        testID="signup-email"
      />
      <AppTextField
        label="パスワード"
        required
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        hint="8文字以上"
        testID="signup-password"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label="登録する" onPress={submit} loading={loading} testID="signup-submit" />
      <Text style={styles.note}>
        ※ハピマリは35歳以上の方向けのサービスです。{'\n'}
        次の画面でご本人の情報をご入力いただきます。
      </Text>
      <AppButton
        label="ログインはこちら"
        variant="secondary"
        onPress={() => router.replace('/(auth)/login')}
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
    lineHeight: 24,
    marginVertical: spacing.lg,
  },
});
