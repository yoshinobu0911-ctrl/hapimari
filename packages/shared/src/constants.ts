/**
 * ビジネスルール定数（SPEC §4）とUI基準（SPEC §2）
 */

/** R1: 登録可能年齢（女性35歳以上・男性45歳以上、上限なし） */
export const MIN_AGE = {
  female: 35,
  male: 45,
} as const;

/** R4: 同一女性が24時間に受け取る「いいね」上限 */
export const FEMALE_DAILY_LIKE_LIMIT = 20;

/** R5: 通話解禁のメッセージ数（5往復=10メッセージ） */
export const CALL_UNLOCK_MESSAGE_COUNT = 10;

/** R5: デート打診バナー表示のメッセージ数（10往復=20メッセージ） */
export const DATE_PROPOSAL_MESSAGE_COUNT = 20;

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
