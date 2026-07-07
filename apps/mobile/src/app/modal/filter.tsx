import {
  type AreaFilter,
  AVAILABLE_TIMES,
  type AvailableTime,
  DEFAULT_DISCOVER_FILTER,
  DEFAULT_DISTANCE_LIMIT_KM,
  type DiscoverFilter,
  MARITAL_HISTORIES,
  MARRIAGE_INTENTS,
  type MaritalHistory,
  type MarriageIntent,
  PREFECTURES,
  type Prefecture,
} from '@hapimari/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/app-button';
import { ChoiceGroup, MultiChoiceGroup } from '@/components/ui/choice-group';
import { Screen } from '@/components/ui/screen';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';
import { useFilterStore } from '@/stores/filter';
import { useLocationStore } from '@/stores/location';

/** 年齢下限の選択肢（5歳刻み・指定なしあり） */
const AGE_MIN_OPTIONS = [
  { value: 'none', label: '指定なし' },
  ...[35, 40, 45, 50, 55, 60, 65, 70].map((n) => ({ value: String(n), label: `${n}歳以上` })),
];

/** 年齢上限の選択肢（5歳刻み・指定なしあり） */
const AGE_MAX_OPTIONS = [
  { value: 'none', label: '指定なし' },
  ...[39, 44, 49, 54, 59, 64, 69, 74].map((n) => ({ value: String(n), label: `${n}歳以下` })),
];

/** 距離上限の選択肢（判断#10: 既定30km・変更可） */
const DISTANCE_OPTIONS = [
  { value: '10', label: '10km以内' },
  { value: '20', label: '20km以内' },
  { value: '30', label: `30km以内（おすすめ）` },
  { value: '50', label: '50km以内' },
  { value: '100', label: '100km以内' },
  { value: 'none', label: '距離の制限なし' },
];

/** 都道府県の複数選択（チップを折り返して並べる） */
function PrefectureChips({
  selected,
  onToggle,
}: {
  selected: Prefecture[];
  onToggle: (p: Prefecture) => void;
}) {
  return (
    <View style={styles.chips}>
      {PREFECTURES.map((p) => {
        const on = selected.includes(p);
        return (
          <Pressable
            key={p}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={p}
            onPress={() => onToggle(p)}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{p}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * フィルタ検索モーダル（M6改訂: 距離モードが既定・子持ちフィルタは撤去=案A）
 */
export default function FilterModal() {
  const router = useRouter();
  const applied = useFilterStore((s) => s.filter);
  const setFilter = useFilterStore((s) => s.setFilter);
  const gpsAvailable = useLocationStore((s) => s.gpsAvailable);

  const [draft, setDraft] = useState<DiscoverFilter>(applied);

  const update = (patch: Partial<DiscoverFilter>) => setDraft((d) => ({ ...d, ...patch }));

  const areaOptions = [
    { value: 'distance', label: '現在地からの距離で絞る（おすすめ）' },
    { value: 'custom', label: '県を選ぶ（複数可）' },
    { value: 'all', label: '全国' },
  ] as const;

  const togglePrefecture = (p: Prefecture) => {
    const current = draft.area.mode === 'custom' ? draft.area.prefectures : [];
    const next = current.includes(p) ? current.filter((x) => x !== p) : [...current, p];
    update({ area: { mode: 'custom', prefectures: next } });
  };

  const apply = () => {
    setFilter(draft);
    router.back();
  };

  const reset = () => setDraft({ ...DEFAULT_DISCOVER_FILTER, sort: draft.sort });

  return (
    <Screen title="絞り込み" subtitle="条件はすべて「かつ」で絞り込まれます。">
      <ChoiceGroup
        label="年齢（下限）"
        options={AGE_MIN_OPTIONS}
        value={draft.ageMin != null ? String(draft.ageMin) : 'none'}
        onChange={(v) => update({ ageMin: v === 'none' ? null : Number(v) })}
      />
      <ChoiceGroup
        label="年齢（上限）"
        options={AGE_MAX_OPTIONS}
        value={draft.ageMax != null ? String(draft.ageMax) : 'none'}
        onChange={(v) => update({ ageMax: v === 'none' ? null : Number(v) })}
      />

      <ChoiceGroup
        label="お相手をさがす範囲"
        options={areaOptions}
        value={draft.area.mode}
        onChange={(mode) => {
          const area: AreaFilter =
            mode === 'custom'
              ? {
                  mode: 'custom',
                  prefectures: draft.area.mode === 'custom' ? draft.area.prefectures : [],
                }
              : mode === 'distance'
                ? { mode: 'distance', limitKm: DEFAULT_DISTANCE_LIMIT_KM }
                : { mode };
          update({ area });
        }}
      />
      {draft.area.mode === 'distance' ? (
        <>
          <ChoiceGroup
            label="距離の上限"
            options={DISTANCE_OPTIONS}
            value={draft.area.limitKm != null ? String(draft.area.limitKm) : 'none'}
            onChange={(v) =>
              update({ area: { mode: 'distance', limitKm: v === 'none' ? null : Number(v) } })
            }
          />
          {gpsAvailable === false ? (
            <Text style={styles.gpsNote}>
              位置情報が未許可のため、距離のかわりに「同じ県のお相手」を表示しています。
              距離で絞るには位置情報を許可してください。
            </Text>
          ) : null}
        </>
      ) : null}
      {draft.area.mode === 'custom' ? (
        <PrefectureChips selected={draft.area.prefectures} onToggle={togglePrefecture} />
      ) : null}

      <MultiChoiceGroup
        label="結婚歴（選ばなければすべて）"
        options={MARITAL_HISTORIES}
        values={draft.maritalHistories}
        onChange={(values) => update({ maritalHistories: values as MaritalHistory[] })}
      />

      <MultiChoiceGroup
        label="結婚への考え（選ばなければすべて）"
        options={MARRIAGE_INTENTS}
        values={draft.marriageIntents}
        onChange={(values) => update({ marriageIntents: values as MarriageIntent[] })}
      />

      <MultiChoiceGroup
        label="会える時間帯（1つでも重なればヒット）"
        options={AVAILABLE_TIMES}
        values={draft.availableTimes}
        onChange={(values) => update({ availableTimes: values as AvailableTime[] })}
      />

      <View style={styles.actions}>
        <AppButton label="この条件でさがす" onPress={apply} testID="filter-apply" />
        <AppButton
          label="条件をリセット"
          variant="secondary"
          onPress={reset}
          testID="filter-reset"
        />
        <AppButton
          label="閉じる"
          variant="secondary"
          onPress={() => router.back()}
          testID="filter-close"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    minHeight: sizes.tapArea,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
  },
  chipOn: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primarySoft,
  },
  chipText: {
    fontSize: fontSize.body,
    color: colors.text,
  },
  chipTextOn: {
    color: colors.primary,
    fontWeight: '700',
  },
  gpsNote: {
    fontSize: fontSize.small,
    color: colors.textSub,
    lineHeight: 24,
    marginBottom: spacing.md,
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
});
