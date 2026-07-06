import {
  type AreaFilter,
  AVAILABLE_TIMES,
  type AvailableTime,
  DEFAULT_DISCOVER_FILTER,
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
import { useMyProfile } from '@/hooks/use-my-profile';
import { useFilterStore } from '@/stores/filter';

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

const CHILDREN_OPTIONS = [
  { value: 'any', label: '気にしない' },
  { value: 'has', label: 'お子さまがいる方' },
  { value: 'none', label: 'お子さまがいない方' },
] as const;

/** 都道府県の複数選択（チップを折り返して並べる。47行の縦リストにしない） */
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
 * フィルタ検索モーダル（docs/design/M3_design.md §5.3・SPEC §5の6条件・すべてAND）
 * エリアの既定は R10「あなたの県+隣接県」。
 */
export default function FilterModal() {
  const router = useRouter();
  const { data: myProfile } = useMyProfile();
  const applied = useFilterStore((s) => s.filter);
  const setFilter = useFilterStore((s) => s.setFilter);

  const [draft, setDraft] = useState<DiscoverFilter>(applied);

  const update = (patch: Partial<DiscoverFilter>) => setDraft((d) => ({ ...d, ...patch }));

  const areaOptions = [
    {
      value: 'default',
      label: myProfile ? `あなたの県+隣接県（${myProfile.prefecture}周辺）` : 'あなたの県+隣接県',
    },
    { value: 'all', label: '全国' },
    { value: 'custom', label: '県を選ぶ（複数可）' },
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

  const reset = () => setDraft(DEFAULT_DISCOVER_FILTER);

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
        label="お住まいのエリア"
        options={areaOptions}
        value={draft.area.mode}
        onChange={(mode) => {
          const area: AreaFilter =
            mode === 'custom'
              ? {
                  mode: 'custom',
                  prefectures: draft.area.mode === 'custom' ? draft.area.prefectures : [],
                }
              : { mode };
          update({ area });
        }}
      />
      {draft.area.mode === 'custom' ? (
        <PrefectureChips selected={draft.area.prefectures} onToggle={togglePrefecture} />
      ) : null}

      <MultiChoiceGroup
        label="結婚歴（選ばなければすべて）"
        options={MARITAL_HISTORIES}
        values={draft.maritalHistories}
        onChange={(values) => update({ maritalHistories: values as MaritalHistory[] })}
      />

      <ChoiceGroup
        label="お子さまの有無"
        options={CHILDREN_OPTIONS}
        value={draft.children}
        onChange={(children) => update({ children })}
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
  actions: {
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
});
