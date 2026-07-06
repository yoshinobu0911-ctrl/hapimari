import {
  AVAILABLE_TIMES,
  type AvailableTime,
  BIO_MAX_LENGTH,
  MARRIAGE_INTENTS,
  type MarriageIntent,
  type Prefecture,
} from '@hapimari/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { AppTextField } from '@/components/ui/app-text-field';
import { ChoiceGroup, MultiChoiceGroup } from '@/components/ui/choice-group';
import { PrefectureField } from '@/components/ui/prefecture-field';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { type ProfileUpdate, supabase } from '@/lib/supabase';
import { uploadProfilePhoto } from '@/lib/upload-photo';
import { useAuthStore } from '@/stores/auth';

export default function ProfileEdit() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const { data: profile } = useMyProfile();

  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [prefecture, setPrefecture] = useState<Prefecture | null>(
    (profile?.prefecture as Prefecture | undefined) ?? null,
  );
  const [city, setCity] = useState(profile?.city ?? '');
  const [marriageIntent, setMarriageIntent] = useState<MarriageIntent | null>(
    (profile?.marriage_intent as MarriageIntent | null) ?? null,
  );
  const [availableTimes, setAvailableTimes] = useState<AvailableTime[]>(
    (profile?.available_times as AvailableTime[] | null) ?? [],
  );
  const [cohabitView, setCohabitView] = useState(profile?.cohabit_view ?? '');
  const [moneyView, setMoneyView] = useState(profile?.money_view ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [newPhoto, setNewPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!profile || !session) return null;

  const currentPhoto = newPhoto?.uri ?? profile.photo_urls?.[0];

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) setNewPhoto(result.assets[0]);
  };

  const save = async () => {
    setError(null);
    if (!nickname.trim()) {
      setError('ニックネームを入力してください');
      return;
    }
    if (!prefecture) {
      setError('お住まいの都道府県を選択してください');
      return;
    }
    setSaving(true);
    try {
      let photoUrls = profile.photo_urls ?? [];
      if (newPhoto) {
        const url = await uploadProfilePhoto(session.user.id, newPhoto);
        photoUrls = [url, ...photoUrls.slice(1)];
      }
      const payload: ProfileUpdate = {
        nickname: nickname.trim(),
        prefecture,
        city: city.trim() || null,
        marriage_intent: marriageIntent,
        available_times: availableTimes,
        cohabit_view: cohabitView.trim() || null,
        money_view: moneyView.trim() || null,
        bio: bio.trim() || null,
        photo_urls: photoUrls,
      };
      const { error: updateError } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', session.user.id);
      if (updateError) {
        setError(`保存に失敗しました: ${updateError.message}`);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen title="プロフィール編集">
      <View style={styles.photoArea}>
        {currentPhoto ? (
          <Image source={{ uri: currentPhoto }} style={styles.photo} contentFit="cover" />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Text style={styles.placeholderText}>写真なし</Text>
          </View>
        )}
        <AppButton label="写真を変更する" variant="secondary" onPress={pickPhoto} />
      </View>
      <AppTextField
        label="ニックネーム"
        required
        value={nickname}
        onChangeText={setNickname}
        testID="edit-nickname"
      />
      <PrefectureField required value={prefecture} onChange={setPrefecture} />
      <AppTextField
        label="市区町村（任意）"
        value={city}
        onChangeText={setCity}
        testID="edit-city"
      />
      <ChoiceGroup
        label="結婚への考え"
        options={MARRIAGE_INTENTS}
        value={marriageIntent}
        onChange={setMarriageIntent}
      />
      <MultiChoiceGroup
        label="お相手と会いやすい時間帯"
        options={AVAILABLE_TIMES}
        values={availableTimes}
        onChange={setAvailableTimes}
      />
      <AppTextField
        label="同居についての考え（任意）"
        value={cohabitView}
        onChangeText={setCohabitView}
      />
      <AppTextField
        label="お金についての考え（任意）"
        value={moneyView}
        onChangeText={setMoneyView}
      />
      <AppTextField
        label="自己紹介（任意）"
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={BIO_MAX_LENGTH}
        hint={`${bio.length} / ${BIO_MAX_LENGTH}文字`}
        testID="edit-bio"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <AppButton label="保存する" onPress={save} loading={saving} testID="edit-save" />
        <AppButton label="キャンセル" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoArea: {
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  photo: {
    width: 150,
    height: 200,
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
  error: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  actions: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
});
