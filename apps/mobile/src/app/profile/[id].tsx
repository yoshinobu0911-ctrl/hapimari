import {
  AVAILABLE_TIMES,
  type CompatibilityInput,
  calcCompatibility,
  compatibilityReasons,
  formatDistanceLabel,
  LIKE_MESSAGE_MAX_LENGTH,
  MARITAL_HISTORIES,
  MARRIAGE_INTENTS,
  shouldShowCompatibility,
  VALUE_TAG_LABELS,
} from '@hapimari/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProfilePhoto } from '@/components/profile-photo';
import { AppButton } from '@/components/ui/app-button';
import { AppTextField } from '@/components/ui/app-text-field';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { logEvent } from '@/lib/analytics';
import { confirmDialog } from '@/lib/confirm';
import { fetchDistances } from '@/lib/discover-query';
import { sendLike } from '@/lib/like-api';
import { type Profile, type PublicProfile, supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

// M6.5: 相性計算はタグ・時間帯・結婚観のみ（理解項目は廃止・秘匿情報を使わない）
function toCompatInput(p: Profile | PublicProfile): CompatibilityInput {
  return {
    valueTags: p.value_tags ?? [],
    availableTimes: p.available_times ?? [],
    marriageIntent: p.marriage_intent,
  };
}

const MARITAL_LABEL = Object.fromEntries(MARITAL_HISTORIES.map((m) => [m.value, m.label]));
const INTENT_LABEL = Object.fromEntries(MARRIAGE_INTENTS.map((m) => [m.value, m.label]));
const TIME_LABEL = Object.fromEntries(AVAILABLE_TIMES.map((t) => [t.value, t.label]));

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

/**
 * プロフィール詳細（docs/design/M3_design.md §5.2）
 * ここで初めて結婚歴・子ども等の事情を表示する（一覧カードには出さない: デザイン原則1）。
 * 主要アクションは「いいねを送る」1つ。通報・ブロックは右上「…」から。
 */
export default function ProfileDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const { data: myProfile } = useMyProfile();
  const myId = session?.user.id ?? '';

  // 行動ログ: プロフィール閲覧（レコメンドの学習データとして初日から蓄積する）
  useEffect(() => {
    if (id && session) logEvent('profile_view', id);
  }, [id, session]);

  const [likeMessage, setLikeMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['profile', id],
    enabled: !!id && !!session,
    queryFn: async () => {
      // M6.5: 他人のプロフィールは profiles_public ビュー経由（birth_date等は取得不能）
      const { data, error } = await supabase
        .from('profiles_public')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as PublicProfile | null;
    },
  });

  const sentLikeQuery = useQuery({
    queryKey: ['sent-like', myId, id],
    enabled: !!id && !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('likes')
        .select('id')
        .eq('from_user', myId)
        .eq('to_user', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // 現在地からの距離（丸め済みkm。位置未許可なら null・M6 B6）
  const distanceQuery = useQuery({
    queryKey: ['distance', myId, id],
    enabled: !!id && !!session,
    queryFn: async () => {
      const map = await fetchDistances([id ?? '']);
      return map.get(id ?? '') ?? null;
    },
  });
  const distanceKm = distanceQuery.data ?? null;

  // マッチ正規化規約: user_a = 小さいUUID, user_b = 大きいUUID
  const [pairA, pairB] = [myId, id ?? ''].sort();
  const matchQuery = useQuery({
    queryKey: ['match-with', myId, id],
    enabled: !!id && !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('id')
        .eq('user_a', pairA)
        .eq('user_b', pairB)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const profile = profileQuery.data;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sent-like', myId, id] });
    queryClient.invalidateQueries({ queryKey: ['match-with', myId, id] });
    queryClient.invalidateQueries({ queryKey: ['matches', myId] });
  };

  const onSendLike = async () => {
    if (!id) return;
    setSending(true);
    setLikeError(null);
    const result = await sendLike(id, likeMessage.trim() || undefined);
    setSending(false);
    if (!result.ok) {
      // R3エラー等はEdge Functionのメッセージをそのまま表示（受け入れ条件2）
      setLikeError(result.message);
      return;
    }
    invalidate();
    if (result.matched) {
      confirmDialog(
        'マッチしました！',
        `${profile?.nickname ?? 'お相手'}さんとマッチしました。メッセージを送ってみましょう。`,
        () => {
          if (result.matchId) router.push(`/chat/${result.matchId}`);
        },
      );
    }
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="戻る"
        testID="profile-back"
        onPress={() => router.back()}
        style={styles.headerButton}
      >
        <Text style={styles.headerButtonText}>← 戻る</Text>
      </Pressable>
      {profile ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="通報・ブロック"
          testID="profile-menu"
          onPress={() =>
            router.push({
              pathname: '/modal/report-block',
              params: { userId: profile.id, nickname: profile.nickname },
            })
          }
          style={styles.headerButton}
        >
          <Text style={styles.headerButtonText}>…</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (profileQuery.isPending) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  // RLSによりブロック関係・退会・凍結の相手は取得できない
  if (!profile) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            このプロフィールは表示できません。{'\n'}
            退会またはブロックされたユーザーの可能性があります。
          </Text>
        </View>
      </View>
    );
  }

  const compatibility =
    myProfile && profile
      ? calcCompatibility(toCompatInput(myProfile), toCompatInput(profile), distanceKm)
      : 0;
  const reasons =
    myProfile && profile
      ? compatibilityReasons(
          toCompatInput(myProfile),
          toCompatInput(profile),
          VALUE_TAG_LABELS,
          TIME_LABEL,
        )
      : [];
  const myTags = new Set(myProfile?.value_tags ?? []);
  const alreadyLiked = !!sentLikeQuery.data;
  const match = matchQuery.data;
  const photos = profile.photo_urls ?? [];

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ProfilePhoto
          path={photos[0]}
          style={styles.photo}
          placeholderStyle={styles.photoPlaceholder}
          placeholderTextStyle={styles.photoPlaceholderText}
        />
        {photos.length > 1 ? (
          <ScrollView horizontal style={styles.subPhotos} showsHorizontalScrollIndicator={false}>
            {photos.slice(1).map((path) => (
              <ProfilePhoto key={path} path={path} style={styles.subPhoto} />
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.body}>
          <Text style={styles.name} testID="profile-name">
            {profile.nickname}
            <Text style={styles.age}> {profile.age}歳</Text>
          </Text>
          {shouldShowCompatibility(compatibility) ? (
            <Text style={styles.compatibility}>相性 {compatibility}%</Text>
          ) : null}
          {distanceKm != null ? (
            <Text style={styles.distance} testID="profile-distance">
              📍 現在地から {formatDistanceLabel(distanceKm)}
            </Text>
          ) : null}
          {reasons.length > 0 ? (
            <View style={styles.reasons} testID="profile-reasons">
              {reasons.map((reason) => (
                <Text key={reason} style={styles.reasonText}>
                  ・{reason}
                </Text>
              ))}
            </View>
          ) : null}

          {(profile.value_tags ?? []).length > 0 ? (
            <View style={styles.tags}>
              {(profile.value_tags ?? []).map((tag) => {
                const common = myTags.has(tag);
                return (
                  <View key={tag} style={[styles.tag, common && styles.tagCommon]}>
                    <Text style={[styles.tagText, common && styles.tagTextCommon]}>
                      {common ? '◎ ' : ''}
                      {VALUE_TAG_LABELS[tag] ?? tag}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          <View style={styles.section}>
            <InfoRow
              label="お住まい"
              value={`${profile.prefecture}${profile.city ? ` ${profile.city}` : ''}`}
            />
            <InfoRow label="結婚歴" value={MARITAL_LABEL[profile.marital_history]} />
            {/* M6 B1（案A）: お子さま関連はプロフィールに表示しない（オーナー決定 2026-07-07） */}
            <InfoRow
              label="結婚への考え"
              value={profile.marriage_intent ? INTENT_LABEL[profile.marriage_intent] : null}
            />
            <InfoRow label="同居について" value={profile.cohabit_view} />
            <InfoRow label="お金について" value={profile.money_view} />
            <InfoRow
              label="会える時間帯"
              value={
                (profile.available_times ?? []).map((t) => TIME_LABEL[t] ?? t).join('・') || null
              }
            />
          </View>

          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

          <View style={styles.badges}>
            {profile.is_verified ? <Text style={styles.badgeOn}>✓ 本人確認済み</Text> : null}
            {profile.income_verified ? <Text style={styles.badgeOn}>✓ 収入証明済み</Text> : null}
            {profile.single_cert_verified ? (
              <Text style={styles.badgeOn}>✓ 独身証明済み</Text>
            ) : null}
          </View>

          {match ? (
            <AppButton
              label="メッセージを送る"
              onPress={() => router.push(`/chat/${match.id}`)}
              testID="profile-to-chat"
            />
          ) : (
            <>
              {!alreadyLiked ? (
                <AppTextField
                  label="一言メッセージ（任意）"
                  placeholder="例）はじめまして。プロフィールを拝見しました。"
                  value={likeMessage}
                  onChangeText={setLikeMessage}
                  maxLength={LIKE_MESSAGE_MAX_LENGTH}
                  multiline
                  testID="like-message"
                />
              ) : null}
              {likeError ? (
                <Text style={styles.likeError} testID="like-error">
                  {likeError}
                </Text>
              ) : null}
              <AppButton
                label={alreadyLiked ? 'いいね済み' : 'いいねを送る'}
                onPress={onSendLike}
                disabled={alreadyLiked}
                loading={sending}
                testID="like-send"
              />
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  headerButton: {
    minHeight: sizes.tapArea,
    minWidth: sizes.tapArea,
    justifyContent: 'center',
  },
  headerButtonText: {
    fontSize: fontSize.heading,
    color: colors.primary,
    fontWeight: '600',
  },
  scroll: {
    paddingBottom: spacing.xl * 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
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
    fontSize: fontSize.body,
    color: colors.textSub,
  },
  subPhotos: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  subPhoto: {
    width: 96,
    height: 128,
    borderRadius: sizes.radius,
    marginRight: spacing.sm,
    backgroundColor: colors.surface,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  name: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  age: {
    fontSize: 22,
    fontWeight: '500',
  },
  compatibility: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.primary,
    marginTop: spacing.xs,
  },
  distance: {
    fontSize: fontSize.body,
    color: colors.textSub,
    marginTop: spacing.xs,
  },
  reasons: {
    marginTop: spacing.sm,
    gap: 2,
  },
  reasonText: {
    fontSize: fontSize.body,
    color: colors.text,
    lineHeight: 24,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  tag: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.surface,
  },
  tagCommon: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  tagText: {
    fontSize: fontSize.body,
    color: colors.text,
  },
  tagTextCommon: {
    color: colors.primary,
    fontWeight: '700',
  },
  section: {
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  infoLabel: {
    width: 150,
    fontSize: fontSize.body,
    color: colors.textSub,
  },
  infoValue: {
    flex: 1,
    fontSize: fontSize.body,
    color: colors.text,
    lineHeight: 24,
  },
  bio: {
    fontSize: fontSize.body,
    color: colors.text,
    lineHeight: 28,
    marginTop: spacing.lg,
  },
  badges: {
    gap: spacing.xs,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  badgeOn: {
    fontSize: fontSize.body,
    color: colors.badge,
    fontWeight: '600',
  },
  likeError: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: '600',
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
});
