import { MARITAL_HISTORIES } from '@hapimari/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { ChoiceGroup, MultiChoiceGroup, YesNoChoice } from '@/components/ui/choice-group';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, spacing } from '@/constants/theme';
import { useOnboardingStore } from '@/stores/onboarding';

type Understanding = 'children' | 'remarriage';

export default function Step2() {
  const router = useRouter();
  const draft = useOnboardingStore();
  const [error, setError] = useState<string | null>(null);

  const understandings: Understanding[] = [
    ...(draft.understandsChildren ? (['children'] as const) : []),
    ...(draft.understandsRemarriage ? (['remarriage'] as const) : []),
  ];

  const next = () => {
    setError(null);
    if (!draft.maritalHistory) {
      setError('結婚歴を選択してください');
      return;
    }
    if (draft.hasChildren === null) {
      setError('お子さまの有無を選択してください');
      return;
    }
    if (draft.hasChildren && draft.childrenLivingTogether === null) {
      setError('お子さまと同居しているかを選択してください');
      return;
    }
    router.push('/(auth)/onboarding/step3');
  };

  return (
    <Screen
      title="結婚歴・お子さま（2/4）"
      subtitle="正直にお答えいただくことが、良いご縁につながります。"
    >
      <ChoiceGroup
        label="結婚歴"
        required
        options={MARITAL_HISTORIES}
        value={draft.maritalHistory}
        onChange={(v) => draft.set({ maritalHistory: v })}
      />
      <YesNoChoice
        label="お子さまはいらっしゃいますか？"
        required
        value={draft.hasChildren}
        onChange={(v) =>
          draft.set({
            hasChildren: v,
            ...(v ? {} : { childrenLivingTogether: null, okChildDate: null }),
          })
        }
      />
      {draft.hasChildren ? (
        <>
          <YesNoChoice
            label="お子さまと同居していますか？"
            required
            value={draft.childrenLivingTogether}
            onChange={(v) => draft.set({ childrenLivingTogether: v })}
          />
          <YesNoChoice
            label="お子さまも一緒のデートは可能ですか？"
            value={draft.okChildDate}
            onChange={(v) => draft.set({ okChildDate: v })}
          />
        </>
      ) : null}
      <MultiChoiceGroup
        label="お相手への理解（当てはまるものを選択）"
        options={[
          { value: 'children', label: 'お子さまのいるお相手を理解し、尊重します' },
          { value: 'remarriage', label: '再婚・死別を経験したお相手を理解し、尊重します' },
        ]}
        values={understandings}
        onChange={(values) =>
          draft.set({
            understandsChildren: values.includes('children'),
            understandsRemarriage: values.includes('remarriage'),
          })
        }
      />
      <Text style={styles.note}>
        ※「お子さまのいるお相手への理解」を選択していない場合、お子さまのいる女性へ「いいね」を送ることはできません。
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label="次へ" onPress={next} testID="ob-step2-next" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: fontSize.small,
    color: colors.textSub,
    lineHeight: 24,
    marginBottom: spacing.md,
  },
  error: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
});
