/**
 * R4: もらったいいねの表示繰越（docs/design/M3_design.md §5.4）
 *
 * いいね自体は全件保存される。女性側の「もらったいいね」一覧の表示だけ
 * 「1日 FEMALE_DAILY_LIKE_LIMIT 件まで、超過分は翌日以降に繰り越して表示」とする。
 * 男性の受信いいねは制限なし（limit に Infinity を渡す）。
 *
 * 日付は JST のカレンダー日で判定する。
 */

/** Date/ISO文字列を JST のカレンダー日付（yyyy-mm-dd）に変換する */
export function toJstDateString(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** yyyy-mm-dd の翌日を返す */
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface AssignedLike<T> {
  like: T;
  /** このいいねが一覧に現れる JST 日付（yyyy-mm-dd） */
  displayDate: string;
}

export interface LikeVisibilityResult<T> {
  /** 今日までに表示対象となったいいね（created_at 昇順） */
  visible: T[];
  /** 明日以降に繰り越されたいいね（件数表示に使う） */
  carriedOver: T[];
  /** 全いいねへの表示日の割当（デバッグ・テスト用） */
  assignments: AssignedLike<T>[];
}

/**
 * 各いいねに表示日を割り当て、今日（JST）までに表示できるものを返す。
 *
 * アルゴリズム（§5.4）:
 *   created_at 昇順に走査し、
 *   display_date = max(created_at の JST 日付, 直前のいいねの display_date) を仮置き。
 *   その日の割当件数が limit に達していたら翌日に繰り越す。
 *   表示対象 = display_date <= 今日(JST)。
 *
 * @param likes 受信いいね（順不同でよい。内部で created_at 昇順に整列する）
 * @param limit 1日の表示上限。男性受信者は Infinity（無制限）
 * @param now   現在時刻（テスト用に注入可能）
 */
export function assignVisibleDates<T extends { created_at: string | null }>(
  likes: readonly T[],
  limit: number,
  now: Date = new Date(),
): LikeVisibilityResult<T> {
  const sorted = [...likes].sort((a, b) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  );
  const today = toJstDateString(now);

  const assignments: AssignedLike<T>[] = [];
  let currentDate = '';
  let countForDate = 0;

  for (const like of sorted) {
    // created_at が null になることは通常ない（DB default now()）。防御的に「今日」扱い
    let candidate = like.created_at ? toJstDateString(like.created_at) : today;
    if (currentDate && candidate < currentDate) candidate = currentDate;

    if (candidate !== currentDate) {
      currentDate = candidate;
      countForDate = 0;
    }
    if (countForDate >= limit) {
      currentDate = nextDay(currentDate);
      countForDate = 0;
    }
    countForDate += 1;
    assignments.push({ like, displayDate: currentDate });
  }

  return {
    visible: assignments.filter((a) => a.displayDate <= today).map((a) => a.like),
    carriedOver: assignments.filter((a) => a.displayDate > today).map((a) => a.like),
    assignments,
  };
}
