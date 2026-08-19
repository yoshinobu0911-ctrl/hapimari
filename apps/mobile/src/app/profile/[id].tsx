import { Ionicons } from '@expo/vector-icons';
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
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MatchCelebration } from '@/components/match-celebration';
import { ProfilePhoto } from '@/components/profile-photo';
import { AppButton } from '@/components/ui/app-button';
import { AppHeader, HeaderIconButton } from '@/components/ui/app-header';
import { AppTextField } from '@/components/ui/app-text-field';
import { Badge } from '@/components/ui/badge';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { colors, fontSize, radius, sizes, spacing, typography } from '@/constants/theme';
import { useMyProfile } from '@/hooks/use-my-profile';
import { logEvent } from '@/lib/analytics';
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
  /** マッチ成立の演出。null 以外のとき表示（値は成立した matchId） */
  const [celebratedMatchId, setCelebratedMatchId] = useState<string | null>(null);

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
      // マッチ成立の演出（従来はOS標準の confirmDialog だった）。
      // matchId が無い異常時も演出は出し、「メッセージを送る」は閉じるだけになる
      setCelebratedMatchId(result.matchId ?? '');
    }
  };

  const header = (
    <AppHeader
      title={profile?.nickname}
      right={
        profile ? (
          <HeaderIconButton
            name="ellipsis-horizontal"
            label="通報・ブロック"
            onPress={() =>
              router.push({
                pathname: '/modal/report-block',
                params: { userId: profile.id, nickname: profile.nickname },
              })
            }
          />
        ) : null
      }
    />
  );

  if (profileQuery.isPending) {
    return (
      <View style={styles.container}>
        {header}
        <View testID="profile-loading">
          <Skeleton height={360} borderRadius={0} />
          <View style={styles.loadingBody}>
            <Skeleton width="55%" height={28} />
            <Skeleton width="35%" height={22} />
            <Skeleton width="90%" height={20} />
            <Skeleton width="75%" height={20} />
          </View>
        </View>
      </View>
    );
  }

  // RLSによりブロック関係・退会・凍結の相手は取得できない
  if (!profile) {
    return (
      <View style={styles.container}>
        {header}
        <EmptyState
          testID="profile-unavailable"
          icon="person-remove-outline"
          title="このプロフィールは表示できません"
          description="退会またはブロックされたユーザーの可能性があります。"
          actionLabel="さがすに戻る"
          onAction={() => router.back()}
        />
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
          <View style={styles.metaRow}>
            {shouldShowCompatibility(compatibility) ? (
              <View style={styles.compatibility}>
                <Text style={styles.compatibilityText}>相性 {compatibility}%</Text>
              </View>
            ) : null}
            {distanceKm != null ? (
              <View style={styles.distance} testID="profile-distance">
                <Ionicons name="location-outline" size={sizes.iconSm} color={colors.textSub} />
                <Text style={styles.distanceText}>
                  現在地から {formatDistanceLabel(distanceKm)}
                </Text>
              </View>
            ) : null}
          </View>
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
              {(profile.value_tags ?? []).map((tag) => (
                <Chip
                  key={tag}
                  label={VALUE_TAG_LABELS[tag] ?? tag}
                  state={myTags.has(tag) ? 'matched' : 'default'}
                />
              ))}
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
            {profile.is_verified ? (
              <Badge label="本人確認済み" tone="success" icon="shield-checkmark" />
            ) : null}
            {profile.income_verified ? (
              <Badge label="収入証明済み" tone="success" icon="checkmark-circle" />
            ) : null}
            {profile.single_cert_verified ? (
              <Badge label="独身証明済み" tone="success" icon="checkmark-circle" />
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

      <MatchCelebration
        visible={celebratedMatchId !== null}
        partnerName={profile?.nickname ?? 'お相手'}
        partnerPhotoPath={profile?.photo_urls?.[0]}
        myPhotoPath={myProfile?.photo_urls?.[0]}
        onOpenChat={() => {
          const matchId = celebratedMatchId;
          setCelebratedMatchId(null);
          if (matchId) router.push(`/chat/${matchId}`);
        }}
        onClose={() => setCelebratedMatchId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingBottom: spacing.xl * 2,
  },
  loadingBody: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  /**
   * v1 は 3:4（幅375なら高さ500px）で、ヘッダーと合わせると
   * 名前を読むのにスクロールが必要だった。正方形にして最初の画面内に収める。
   */
  photo: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: colors.surface,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: {
    ...typography.body,
    color: colors.textSub,
  },
  subPhotos: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  subPhoto: {
    width: 96,
    height: 128,
    borderRadius: radius.md,
    marginRight: spacing.sm,
    backgroundColor: colors.surface,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  name: {
    ...typography.title,
  },
  age: {
    fontSize: fontSize.headingLg,
    fontWeight: '500',
    color: colors.textSub,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  compatibility: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  compatibilityText: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.primary,
  },
  distance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  distanceText: {
    ...typography.caption,
  },
  reasons: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  reasonText: {
    ...typography.body,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  section: {
    marginTop: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    gap: spacing.md,
  },
  infoLabel: {
    width: 140,
    ...typography.body,
    color: colors.textSub,
  },
  infoValue: {
    flex: 1,
    ...typography.body,
  },
  bio: {
    ...typography.body,
    marginTop: spacing.xl,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  likeError: {
    ...typography.bodyStrong,
    color: colors.danger,
    marginBottom: spacing.sm,
  },
});
