import { canRegister, MIN_AGE } from '@hapimari/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { AppTextField } from '@/components/ui/app-text-field';
import { Banner } from '@/components/ui/banner';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { PrefectureField } from '@/components/ui/prefecture-field';
import { Screen } from '@/components/ui/screen';
import { StepProgress } from '@/components/ui/step-progress';
import { colors, spacing, typography } from '@/constants/theme';
import { draftBirthDate, useOnboardingStore } from '@/stores/onboarding';

export default function Step1() {
  const router = useRouter();
  const draft = useOnboardingStore();
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    setError(null);
    if (!draft.nickname.trim()) {
      setError('ニックネームを入力してください');
      return;
    }
    if (!draft.gender) {
      setError('性別を選択してください');
      return;
    }
    const birthDate = draftBirthDate(draft);
    if (!birthDate) {
      setError('生年月日を正しく入力してください');
      return;
    }
    // R1: 男女とも35歳以上（2026-07-12改定。34歳以下は拒否）
    if (!canRegister(draft.gender, birthDate)) {
      setError(
        `申し訳ございません。ハピマリは${MIN_AGE.female}歳以上の方向けのサービスのため、ご登録いただけません。`,
      );
      return;
    }
    if (!draft.prefecture) {
      setError('お住まいの都道府県を選択してください');
      return;
    }
    router.push('/(auth)/onboarding/step2');
  };

  return (
    <Screen title="基本情報" subtitle="あなたのことを教えてください。">
      <StepProgress current={1} total={4} />
      <AppTextField
        label="ニックネーム"
        required
        value={draft.nickname}
        onChangeText={(v) => draft.set({ nickname: v })}
        placeholder="例: はなこ"
        hint="本名は表示されません"
        testID="ob-nickname"
      />
      <ChoiceGroup
        label="性別"
        required
        options={[
          { value: 'female', label: '女性' },
          { value: 'male', label: '男性' },
        ]}
        value={draft.gender}
        onChange={(v) => draft.set({ gender: v })}
      />
      <Text style={styles.label}>
        生年月日<Text style={styles.required}>（必須）</Text>
      </Text>
      <View style={styles.birthRow}>
        <View style={styles.birthYear}>
          <AppTextField
            value={draft.birthYear}
            onChangeText={(v) => draft.set({ birthYear: v.replace(/[^0-9]/g, '') })}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="1975"
            hint="年"
            testID="ob-birth-year"
          />
        </View>
        <View style={styles.birthSmall}>
          <AppTextField
            value={draft.birthMonth}
            onChangeText={(v) => draft.set({ birthMonth: v.replace(/[^0-9]/g, '') })}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="4"
            hint="月"
            testID="ob-birth-month"
          />
        </View>
        <View style={styles.birthSmall}>
          <AppTextField
            value={draft.birthDay}
            onChangeText={(v) => draft.set({ birthDay: v.replace(/[^0-9]/g, '') })}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="12"
            hint="日"
            testID="ob-birth-day"
          />
        </View>
      </View>
      <PrefectureField
        required
        value={draft.prefecture}
        onChange={(v) => draft.set({ prefecture: v })}
      />
      <AppTextField
        label="市区町村（任意）"
        value={draft.city}
        onChangeText={(v) => draft.set({ city: v })}
        placeholder="例: 世田谷区"
        testID="ob-city"
      />
      {error ? (
        <View style={styles.error}>
          <Banner testID="ob-step1-error" tone="danger" title={error} />
        </View>
      ) : null}
      <AppButton label="次へ" onPress={next} testID="ob-step1-next" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  required: {
    color: colors.primary,
    fontWeight: '400',
  },
  birthRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  birthYear: {
    flex: 2,
  },
  birthSmall: {
    flex: 1,
  },
  error: {
    marginBottom: spacing.lg,
  },
});
