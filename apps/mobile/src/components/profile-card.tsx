import { calcAge, shouldShowCompatibility } from '@hapimari/shared';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, sizes, spacing } from '@/constants/theme';
import type { Profile } from '@/lib/supabase';

interface Props {
  profile: Profile;
  /** 相性スコア（40〜98）。discover側で calcCompatibility により算出 */
  compatibility: number;
  /** 現在地からの距離（丸め済みラベル）。位置未許可・距離不明時は undefined（M6 判断#9） */
  distanceLabel?: string;
  onPress?: () => void;
}

/**
 * discover のカード（グリッド表示・スワイプUIにしない: SPEC §5）
 * 表示は「写真・名前・年齢・相性」のみ。文字は写真に重ねない。
 * 相性%は85%以上のときだけ表示する（特別感を出すプロダクト仕様）。
 * 結婚歴・子どもの有無などの事情はプロフィール詳細（M3）で伝える。
 */
export function ProfileCard({ profile, compatibility, distanceLabel, onPress }: Props) {
  const photo = profile.photo_urls?.[0];
  const showCompatibility = shouldShowCompatibility(compatibility);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        showCompatibility
          ? `${profile.nickname}さん ${calcAge(profile.birth_date)}歳 相性${compatibility}パーセント`
          : `${profile.nickname}さん ${calcAge(profile.birth_date)}歳`
      }
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" />
      ) : (
        <View style={[styles.photo, styles.photoPlaceholder]}>
          <Text style={styles.photoPlaceholderText}>写真なし</Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {profile.nickname}
          <Text style={styles.age}> {calcAge(profile.birth_date)}歳</Text>
        </Text>
        {showCompatibility ? <Text style={styles.compatibility}>相性 {compatibility}%</Text> : null}
        {distanceLabel ? <Text style={styles.distance}>📍 {distanceLabel}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: spacing.sm,
    borderRadius: sizes.radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: colors.surface,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: {
    fontSize: 16,
    color: colors.textSub,
  },
  body: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  age: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.text,
  },
  compatibility: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.primary,
  },
  distance: {
    fontSize: 16,
    color: colors.textSub,
  },
});
