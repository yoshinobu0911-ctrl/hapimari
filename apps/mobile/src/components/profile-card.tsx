import { Ionicons } from '@expo/vector-icons';
import { shouldShowCompatibility } from '@hapimari/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ProfilePhoto } from '@/components/profile-photo';
import { colors, radius, shadow, sizes, spacing, typography } from '@/constants/theme';
import type { PublicProfile } from '@/lib/supabase';

interface Props {
  profile: PublicProfile;
  /** 相性スコア（40〜98）。discover側で calcCompatibility により算出 */
  compatibility: number;
  /** 現在地からの距離（丸め済みラベル）。位置未許可・距離不明時は undefined（M6 判断#9） */
  distanceLabel?: string;
  onPress?: () => void;
}

/** 名前行の下の帯。相性・距離の有無でカード高さが変わらないよう高さを固定する */
const META_HEIGHT = 26;

/** 年齢は名前より一段小さく、ただし16pt下限は守る */
const AGE_FONT_SIZE = 17;

/**
 * discover のカード（グリッド表示・スワイプUIにしない: SPEC §5）
 * 表示は「写真・名前・年齢・相性」のみ。文字は写真に重ねない。
 * 相性%は85%以上のときだけ表示する（特別感を出すプロダクト仕様）。
 * 結婚歴・子どもの有無などの事情はプロフィール詳細（M3）で伝える。
 *
 * v2: 相性%の有無でカードの背丈が変わり2列グリッドがガタついていたため、
 * 名前行の下の帯を固定高にした。相性%は文字色だけで示すと名前より目立ちすぎるため、
 * 面色を持つ小さなラベルに変更している。
 */
export function ProfileCard({ profile, compatibility, distanceLabel, onPress }: Props) {
  const showCompatibility = shouldShowCompatibility(compatibility);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        showCompatibility
          ? `${profile.nickname}さん ${profile.age}歳 相性${compatibility}パーセント`
          : `${profile.nickname}さん ${profile.age}歳`
      }
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <ProfilePhoto
        path={profile.photo_urls?.[0]}
        style={styles.photo}
        placeholderStyle={styles.photoPlaceholder}
        placeholderTextStyle={styles.photoPlaceholderText}
      />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {profile.nickname}
          <Text style={styles.age}> {profile.age}歳</Text>
        </Text>
        <View style={styles.meta}>
          {showCompatibility ? (
            <View style={styles.compatibility}>
              <Text style={styles.compatibilityText}>相性 {compatibility}%</Text>
            </View>
          ) : null}
          {distanceLabel ? (
            <View style={styles.distance}>
              <Ionicons name="location-outline" size={sizes.iconSm} color={colors.textSub} />
              <Text style={styles.distanceText} numberOfLines={1}>
                {distanceLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    overflow: 'hidden',
    ...shadow.sm,
  },
  pressed: {
    opacity: 0.85,
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
    paddingHorizontal: spacing.sm + spacing.xs,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm + spacing.xs,
    gap: spacing.xs,
  },
  name: {
    ...typography.heading,
  },
  age: {
    fontSize: AGE_FONT_SIZE,
    fontWeight: '500',
    color: colors.textSub,
  },
  meta: {
    height: META_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  compatibility: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  compatibilityText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  distance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 1,
  },
  distanceText: {
    fontSize: 16,
    color: colors.textSub,
  },
});
