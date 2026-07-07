import { supabaseAdmin } from '@/lib/supabase-admin';
import { computeTodayStats } from './actions';

export const dynamic = 'force-dynamic';

interface StatsRow {
  date: string;
  active_male: number | null;
  active_female: number | null;
  new_matches: number | null;
  dates_confirmed: number | null;
  forced_withdrawals: number | null;
}

function jstMonthNow(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' })
    .format(new Date())
    .slice(0, 7);
}

/**
 * 透明性レポート（SPEC §6 M6 / M6設計書 A4）
 * 月次の daily_stats を集計し、公開用JSONを生成する。
 */
export default async function TransparencyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const target = /^\d{4}-\d{2}$/.test(month ?? '') ? (month as string) : jstMonthNow();
  const [y, m] = target.split('-').map(Number);
  const start = `${target}-01`;
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('daily_stats')
    .select('*')
    .gte('date', start)
    .lt('date', end)
    .order('date', { ascending: true });

  if (error) {
    return <p className="text-red-600">読み込みエラー: {error.message}</p>;
  }

  const rows = (data ?? []) as StatsRow[];
  const latest = rows[rows.length - 1];
  const sum = (key: 'new_matches' | 'dates_confirmed') =>
    rows.reduce((acc, r) => acc + (r[key] ?? 0), 0);

  // 公開用JSON（月末時点のアクティブ数 + 月間合計）
  const report = {
    month: target,
    days_recorded: rows.length,
    active_male: latest?.active_male ?? 0,
    active_female: latest?.active_female ?? 0,
    new_matches: sum('new_matches'),
    dates_confirmed: sum('dates_confirmed'),
    forced_withdrawals: latest?.forced_withdrawals ?? 0,
    generated_at: new Date().toISOString(),
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">透明性レポート（月次）</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form method="GET" className="flex items-end gap-2">
          <label className="flex flex-col text-xs text-gray-500">
            対象月
            <input
              type="month"
              name="month"
              defaultValue={target}
              className="mt-1 rounded border border-gray-300 px-2 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-[#C0392B] px-4 py-2 text-sm font-bold text-white hover:bg-[#96281B]"
          >
            表示
          </button>
        </form>
        <form action={computeTodayStats}>
          <button
            type="submit"
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            本日分を集計する
          </button>
        </form>
      </div>

      <h2 className="mb-2 text-lg font-bold">日次データ（{target}）</h2>
      <table className="mb-6 w-full rounded-lg border border-gray-200 bg-white text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="px-3 py-2">日付</th>
            <th className="px-3 py-2">男性（有効）</th>
            <th className="px-3 py-2">女性（有効）</th>
            <th className="px-3 py-2">新規マッチ</th>
            <th className="px-3 py-2">デート成立</th>
            <th className="px-3 py-2">凍結（累計）</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-gray-400">
                この月の集計データがありません。「本日分を集計する」を押すか、日次バッチ（毎日0:05）をお待ちください。
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.date} className="border-b border-gray-100">
                <td className="px-3 py-2">{row.date}</td>
                <td className="px-3 py-2">{row.active_male ?? '-'}</td>
                <td className="px-3 py-2">{row.active_female ?? '-'}</td>
                <td className="px-3 py-2">{row.new_matches ?? '-'}</td>
                <td className="px-3 py-2">{row.dates_confirmed ?? '-'}</td>
                <td className="px-3 py-2">{row.forced_withdrawals ?? '-'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h2 className="mb-2 text-lg font-bold">公開用JSON</h2>
      <p className="mb-2 text-sm text-gray-500">
        そのままコピーして公開ページ等に利用できます（F-31透明性レポート）。
      </p>
      <pre
        data-testid="transparency-json"
        className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-4 text-sm"
      >
        {JSON.stringify(report, null, 2)}
      </pre>
    </div>
  );
}
