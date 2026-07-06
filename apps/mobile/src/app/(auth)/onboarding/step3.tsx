import { AVAILABLE_TIMES, BIO_MAX_LENGTH, MARRIAGE_INTENTS } from '@hapimari/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { AppTextField } from '@/components/ui/app-text-field';
import { ChoiceGroup, MultiChoiceGroup } from '@/components/ui/choice-group';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, spacing } from '@/constants/theme';
import { useOnboardingStore } from '@/stores/onboarding';

export default function Step3() {
  const router = useRouter();
  const draft = useOnboardingStore();
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    setError(null);
    if (!draft.marriageIntent) {
      setError('結婚への考えを選択してください');
      return;
    }
    if (draft.bio.length > BIO_MAX_LENGTH) {
      setError(`自己紹介は${BIO_MAX_LENGTH}文字以内で入力してください`);
      return;
    }
    router.push('/(auth)/onboarding/step4');
  };

  return (
    <Screen title="価値観（3/4)" subtitle="あなたの考えに近いものをお選びください。">
      <ChoiceGroup
        label="結婚への考え"
        required
        options={MARRIAGE_INTENTS}
        value={draft.marriageIntent}
        onChange={(v) => draft.set({ marriageIntent: v })}
      />
      <MultiChoiceGroup
        label="お相手と会いやすい時間帯"
        options={AVAILABLE_TIMES}
        values={draft.availableTimes}
        onChange={(v) => draft.set({ availableTimes: v })}
      />
      <AppTextField
        label="同居についての考え（任意）"
        value={draft.cohabitView}
        onChangeText={(v) => draft.set({ cohabitView: v })}
        placeholder="例: 子どもが慣れてから一緒に住みたい"
        testID="ob-cohabit"
      />
      <AppTextField
        label="お金についての考え（任意）"
        value={draft.moneyView}
        onChangeText={(v) => draft.set({ moneyView: v })}
        placeholder="例: 生活費は無理のない範囲で分担したい"
        testID="ob-money"
      />
      <AppTextField
        label="自己紹介（任意）"
        value={draft.bio}
        onChangeText={(v) => draft.set({ bio: v })}
        multiline
        maxLength={BIO_MAX_LENGTH}
        placeholder="はじめまして。プロフィールをご覧いただきありがとうございます。"
        hint={`${draft.bio.length} / ${BIO_MAX_LENGTH}文字`}
        testID="ob-bio"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label="次へ" onPress={next} testID="ob-step3-next" />
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
});
