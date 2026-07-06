import { calcAge } from '@hapimari/shared';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import type { Profile } from '@/lib/supabase';

interface Props {
  profile: Profile;
  onPress?: () => void;
}

const MARITAL_LABEL: Record<string, string> = {
  unmarried: '未婚',
  divorced: '離婚',
  widowed: '死別',
};

/** discover のカード（グリッド表示・スワイプUIにしない: SPEC §5） */
export function ProfileCard({ profile, onPress }: Props) {
  const photo = profile.photo_urls?.[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${profile.nickname}さんのプロフィール`}
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
          {profile.nickname} <Text style={styles.age}>{calcAge(profile.birth_date)}歳</Text>
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {profile.prefecture}・{MARITAL_LABEL[profile.marital_history] ?? ''}
          {profile.has_children ? '・子どもあり' : ''}
        </Text>
        {profile.is_verified ? <Text style={styles.badge}>✓ 本人確認済み</Text> : null}
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
    fontSize: fontSize.small,
    color: colors.textSub,
  },
  body: {
    padding: spacing.sm,
    gap: 2,
  },
  name: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  age: {
    fontWeight: '400',
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textSub,
  },
  badge: {
    fontSize: fontSize.small,
    color: colors.badge,
    fontWeight: '600',
  },
});
