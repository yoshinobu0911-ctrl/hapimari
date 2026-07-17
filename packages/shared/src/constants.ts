/**
 * ビジネスルール定数（SPEC §4）とUI基準（SPEC §2）
 */

/**
 * R1: 登録可能年齢（男女とも35歳以上、上限なし）
 * 2026-07-12 オーナー決定: 年齢で強く区切らない方針（ラス恋型にしない）。
 * 旧仕様の男性45歳以上は「35歳女性から見て最年少の男性が10歳上」になり
 * 女性の登録動機を損なうため35歳に統一。
 */
export const MIN_AGE = {
  female: 35,
  male: 35,
} as const;

/**
 * R4: 同一女性が24時間に受け取る「いいね」の表示上限。
 * 超過分は拒否せず翌日以降に繰り越して表示する（like_visibility.ts）。
 * 2026-07-06 オーナー決定で 20→100 に変更（実質セーフティネット扱い。
 * docs/decisions/2026-07-06_M3設計判断.md 参照）
 */
export const FEMALE_DAILY_LIKE_LIMIT = 100;

// 旧R5の通話解禁(10通)・デート打診(20通)のメッセージ数条件は
// 2026-07-12 オーナー決定によりすべて撤廃（マッチ成立直後から利用可）

/** M5: 通話の最大秒数（15分でクライアント側強制終了） */
export const CALL_MAX_DURATION_SECONDS = 900;

/** いいねメッセージの最大文字数 */
export const LIKE_MESSAGE_MAX_LENGTH = 200;

/** メッセージ本文の最大文字数 */
export const MESSAGE_BODY_MAX_LENGTH = 2000;

/** 自己紹介文の最大文字数 */
export const BIO_MAX_LENGTH = 1000;

/** 通報openが3件以上で警告フラグ候補（管理画面から手動確定） */
export const REPORT_WARNING_THRESHOLD = 3;

/** UI: プライマリカラー（落ち着いた暖色・SPEC §2） */
export const COLOR_PRIMARY = '#C0392B';

/** UI: 最小フォントサイズ(pt) */
export const MIN_FONT_SIZE = 16;

/** UI: 主要ボタンの最小高さ(pt) / 最小タップ領域(pt) */
export const MIN_BUTTON_HEIGHT = 48;
export const MIN_TAP_AREA = 44;

/** 会える時間帯（R7: weekday_lunch / weekend_am を上位固定） */
export const AVAILABLE_TIMES = [
  { value: 'weekday_lunch', label: '平日ランチ' },
  { value: 'weekend_am', label: '週末の午前' },
  { value: 'weekend_pm', label: '週末の午後' },
  { value: 'weekday_night', label: '平日の夜' },
] as const;

export type AvailableTime = (typeof AVAILABLE_TIMES)[number]['value'];

/** 結婚歴 */
export const MARITAL_HISTORIES = [
  { value: 'unmarried', label: '未婚' },
  { value: 'divorced', label: '離婚' },
  { value: 'widowed', label: '死別' },
] as const;

export type MaritalHistory = (typeof MARITAL_HISTORIES)[number]['value'];

/** 結婚の意向 */
export const MARRIAGE_INTENTS = [
  { value: 'asap', label: 'すぐにでも結婚したい' },
  { value: 'within_2y', label: '2年以内に結婚したい' },
  { value: 'someday', label: 'いずれ結婚したい' },
  { value: 'partner_only', label: '籍にこだわらない伴侶がほしい' },
] as const;

export type MarriageIntent = (typeof MARRIAGE_INTENTS)[number]['value'];

/** 生年月日から年齢を計算する */
export function calcAge(birthDate: string | Date, now: Date = new Date()): number {
  const birth = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** R1: 登録可能年齢かどうか */
export function canRegister(gender: 'male' | 'female', birthDate: string, now?: Date): boolean {
  return calcAge(birthDate, now) >= MIN_AGE[gender];
}
