import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { type ProfileInsert, supabase } from '@/lib/supabase';
import { uploadProfilePhoto } from '@/lib/upload-photo';
import { useAuthStore } from '@/stores/auth';
import { draftBirthDate, useOnboardingStore } from '@/stores/onboarding';

export default function Step4() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const draft = useOnboardingStore();
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickPhoto = async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setAsset(result.assets[0]);
    }
  };

  const submit = async () => {
    setError(null);
    if (!session) {
      setError('ログイン情報が確認できません。最初からやり直してください。');
      return;
    }
    const birthDate = draftBirthDate(draft);
    if (!draft.gender || !draft.prefecture || !draft.maritalHistory || !birthDate) {
      setError('入力に不足があります。前の画面に戻ってご確認ください。');
      return;
    }
    setSubmitting(true);
    try {
      const photoUrls: string[] = [];
      if (asset) {
        photoUrls.push(await uploadProfilePhoto(session.user.id, asset));
      }
      const payload: ProfileInsert = {
        id: session.user.id,
        nickname: draft.nickname.trim(),
        gender: draft.gender,
        birth_date: birthDate,
        prefecture: draft.prefecture,
        city: draft.city.trim() || null,
        marital_history: draft.maritalHistory,
        has_children: draft.hasChildren ?? false,
        children_living_together: draft.childrenLivingTogether,
        ok_child_date: draft.okChildDate,
        marriage_intent: draft.marriageIntent,
        cohabit_view: draft.cohabitView.trim() || null,
        money_view: draft.moneyView.trim() || null,
        bio: draft.bio.trim() || null,
        available_times: draft.availableTimes,
        value_tags: draft.valueTags,
        understands_children: draft.understandsChildren,
        understands_remarriage: draft.understandsRemarriage,
        photo_urls: photoUrls,
      };
      const { error: insertError } = await supabase.from('profiles').insert(payload);
      if (insertError) {
        // DB側のR1制約（profiles_min_age_check）にかかった場合など
        if (insertError.message.includes('profiles_min_age_check')) {
          setError(
            '年齢条件を満たしていないため登録できません（ご登録は35歳以上の方が対象です）。',
          );
        } else {
          setError(`登録に失敗しました: ${insertError.message}`);
        }
        return;
      }
      draft.reset();
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      router.replace('/(tabs)/discover');
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      title="プロフィール写真（4/4）"
      subtitle="お顔がわかる写真があると、マッチしやすくなります。あとから追加もできます。"
    >
      <View style={styles.photoArea}>
        {asset ? (
          <Image source={{ uri: asset.uri }} style={styles.photo} contentFit="cover" />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Text style={styles.placeholderText}>写真が選択されていません</Text>
          </View>
        )}
      </View>
      <AppButton
        label={asset ? '写真を選び直す' : '写真を選ぶ'}
        variant="secondary"
        onPress={pickPhoto}
        testID="ob-pick-photo"
      />
      <View style={styles.spacer} />
      {error ? (
        <Text style={styles.error} testID="ob-step4-error">
          {error}
        </Text>
      ) : null}
      <AppButton
        label={asset ? 'この内容で登録する' : '写真なしで登録する'}
        onPress={submit}
        loading={submitting}
        testID="ob-submit"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoArea: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  photo: {
    width: 210,
    height: 280,
    borderRadius: sizes.radius,
    backgroundColor: colors.surface,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  placeholderText: {
    fontSize: fontSize.small,
    color: colors.textSub,
  },
  spacer: {
    height: spacing.lg,
  },
  error: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
    marginBottom: spacing.md,
    lineHeight: 24,
  },
});
