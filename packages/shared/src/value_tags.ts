/**
 * 価値観タグ（相性判定の中核）
 *
 * 競合（マリッシュの「グループ」、Pairsの「マイタグ」、youbrideの価値観項目）に
 * 共通するカテゴリ体系（結婚観・金銭感覚・暮らし方・連絡・休日・性格）を、
 * 再婚・中高年向けに再構成した初期30タグ。
 * タグの追加・変更はこのファイルのみを変更すればよい（DBは text[] で保持）。
 */

export const VALUE_TAG_CATEGORIES = [
  { key: 'family', label: '結婚・家族観' },
  { key: 'money', label: 'お金・暮らし' },
  { key: 'living', label: '住まい方' },
  { key: 'comm', label: '連絡・会い方' },
  { key: 'hobby', label: '休日・趣味' },
  { key: 'character', label: '性格' },
] as const;

export type ValueTagCategory = (typeof VALUE_TAG_CATEGORIES)[number]['key'];

export interface ValueTag {
  id: string;
  label: string;
  category: ValueTagCategory;
}

export const VALUE_TAGS: readonly ValueTag[] = [
  // 結婚・家族観
  { id: 'family_no_seki', label: '籍にこだわらない', category: 'family' },
  { id: 'family_soon', label: '早めに一緒になりたい', category: 'family' },
  { id: 'family_kids_like', label: '子どもが好き', category: 'family' },
  { id: 'family_respect_kids', label: 'お相手のお子さまを大切にしたい', category: 'family' },
  { id: 'family_time', label: '家族との時間を大切にしたい', category: 'family' },
  { id: 'family_pet', label: 'ペットも家族', category: 'family' },
  // お金・暮らし
  { id: 'money_sense', label: '金銭感覚が合う人がいい', category: 'money' },
  { id: 'money_steady', label: '老後を見据えて計画的に', category: 'money' },
  { id: 'money_dual', label: '共働きでもOK', category: 'money' },
  { id: 'money_simple', label: '質素でも心豊かに', category: 'money' },
  // 住まい方
  { id: 'living_flex', label: '同居にこだわらない', category: 'living' },
  { id: 'living_weekend', label: '週末婚もあり', category: 'living' },
  { id: 'living_local', label: '地元を離れたくない', category: 'living' },
  { id: 'living_country', label: '田舎暮らしに憧れる', category: 'living' },
  // 連絡・会い方
  { id: 'comm_frequent', label: '連絡はまめに', category: 'comm' },
  { id: 'comm_mypace', label: '連絡はマイペース', category: 'comm' },
  { id: 'comm_lunch', label: 'まずはランチから', category: 'comm' },
  { id: 'comm_slow', label: 'ゆっくり距離を縮めたい', category: 'comm' },
  { id: 'comm_meet', label: 'メッセージより会って話したい', category: 'comm' },
  // 休日・趣味
  { id: 'hobby_together', label: '休日は一緒に過ごしたい', category: 'hobby' },
  { id: 'hobby_own_time', label: 'お互いの時間も大切に', category: 'hobby' },
  { id: 'hobby_travel', label: '旅行が好き', category: 'hobby' },
  { id: 'hobby_cooking', label: '料理が好き', category: 'hobby' },
  { id: 'hobby_walk', label: '散歩・ウォーキングが好き', category: 'hobby' },
  { id: 'hobby_onsen', label: '温泉が好き', category: 'hobby' },
  { id: 'hobby_movie', label: '映画・ドラマが好き', category: 'hobby' },
  // 性格
  { id: 'char_listener', label: '聞き上手といわれる', category: 'character' },
  { id: 'char_humor', label: '笑いのツボが合う人がいい', category: 'character' },
  { id: 'char_thanks', label: '感謝を言葉にしたい', category: 'character' },
  { id: 'char_calm', label: '穏やかに過ごしたい', category: 'character' },
] as const;

export const VALUE_TAG_LABELS: Record<string, string> = Object.fromEntries(
  VALUE_TAGS.map((t) => [t.id, t.label]),
);

/** カテゴリごとのタグ一覧（選択UI用） */
export function valueTagsByCategory(): {
  key: ValueTagCategory;
  label: string;
  tags: ValueTag[];
}[] {
  return VALUE_TAG_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    tags: VALUE_TAGS.filter((t) => t.category === c.key),
  }));
}
