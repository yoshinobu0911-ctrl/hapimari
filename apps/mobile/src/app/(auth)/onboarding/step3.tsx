import { AVAILABLE_TIMES, BIO_MAX_LENGTH, MARRIAGE_INTENTS } from '@hapimari/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { AppTextField } from '@/components/ui/app-text-field';
import { Banner } from '@/components/ui/banner';
import { ChoiceGroup, MultiChoiceGroup } from '@/components/ui/choice-group';
import { Screen } from '@/components/ui/screen';
import { StepProgress } from '@/components/ui/step-progress';
import { ValueTagsSelector } from '@/components/ui/value-tags-selector';
import { colors, spacing, typography } from '@/constants/theme';
import { useOnboardingStore } from '@/stores/onboarding';

export default function Step3() {
  const router = useRouter();
  const draft = useOnboardingStore();
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    setError(null);
    if (draft.valueTags.length < 3) {
      setError('あなたの価値観に近いタグを3つ以上選んでください（相性の判定に使われます）');
      return;
    }
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
    <Screen
      title="価値観"
      subtitle="あなたの考えに近いものをお選びください。お相手との相性の判定に使われます。"
    >
      <StepProgress current={3} total={4} />
      <Text style={styles.sectionTitle}>
        大切にしたい価値観<Text style={styles.required}>（3つ以上・必須）</Text>
      </Text>
      {/* 「3つ以上」という条件を満たせているかを、押すたびに確認できるようにする */}
      <Text
        style={[styles.counter, draft.valueTags.length >= 3 && styles.counterOk]}
        testID="ob-tag-counter"
      >
        {draft.valueTags.length >= 3
          ? `${draft.valueTags.length}つ選択中`
          : `${draft.valueTags.length}つ選択中（あと${3 - draft.valueTags.length}つ）`}
      </Text>
      <ValueTagsSelector values={draft.valueTags} onChange={(v) => draft.set({ valueTags: v })} />
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
      {error ? (
        <View style={styles.error}>
          <Banner testID="ob-step3-error" tone="danger" title={error} />
        </View>
      ) : null}
      <AppButton label="次へ" onPress={next} testID="ob-step3-next" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...typography.label,
    marginBottom: spacing.xs,
  },
  required: {
    color: colors.primary,
    fontWeight: '400',
  },
  counter: {
    ...typography.caption,
    marginBottom: spacing.md,
  },
  counterOk: {
    color: colors.success,
    fontWeight: '600',
  },
  error: {
    marginBottom: spacing.lg,
  },
});
