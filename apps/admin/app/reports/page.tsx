import { REPORT_WARNING_THRESHOLD } from '@hapimari/shared';
import { ConfirmButton } from '@/components/confirm-button';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { actionAndSuspend, dismissReport, markActioned } from './actions';

export const dynamic = 'force-dynamic';

interface ReportRow {
  id: string;
  reporter: string;
  reported: string;
  reason: string;
  detail: string | null;
  status: string;
  created_at: string | null;
  reporter_profile: { nickname: string } | null;
  reported_profile: { nickname: string; status: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  actioned: '対応済み',
  dismissed: '棄却',
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

const SELECT = `id, reporter, reported, reason, detail, status, created_at,
  reporter_profile:profiles!reports_reporter_fkey(nickname),
  reported_profile:profiles!reports_reported_fkey(nickname, status)`;

/**
 * 通報対応（docs/design/M3_design.md §6.1）
 * 同一ユーザーへのopen通報が3件以上の場合は赤枠で強調する
 * （SPEC §3.6の「警告フラグ」はDBカラムを追加せず、この強調表示+手動対応で代替）。
 */
export default async function ReportsPage() {
  const [openResult, historyResult] = await Promise.all([
    supabaseAdmin
      .from('reports')
      .select(SELECT)
      .eq('status', 'open')
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('reports')
      .select(SELECT)
      .neq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  if (openResult.error || historyResult.error) {
    return (
      <p className="text-red-600">
        読み込みエラー: {openResult.error?.message ?? historyResult.error?.message}
      </p>
    );
  }

  const open = (openResult.data ?? []) as unknown as ReportRow[];
  const history = (historyResult.data ?? []) as unknown as ReportRow[];

  // 対象ユーザーごとのopen件数（3件以上を強調）
  const openCountByReported = new Map<string, number>();
  for (const r of open) {
    openCountByReported.set(r.reported, (openCountByReported.get(r.reported) ?? 0) + 1);
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">通報対応</h1>

      {open.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-gray-500">
          未対応の通報はありません。
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {open.map((report) => {
            const count = openCountByReported.get(report.reported) ?? 0;
            const warn = count >= REPORT_WARNING_THRESHOLD;
            return (
              <div
                key={report.id}
                className={`rounded-lg border bg-white p-4 ${
                  warn ? 'border-2 border-[#C0392B]' : 'border-gray-200'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-gray-500">{formatDate(report.created_at)}</span>
                  <span className="text-sm">
                    通報者: <b>{report.reporter_profile?.nickname ?? '(不明)'}</b>
                  </span>
                  <span className="text-sm">
                    対象:{' '}
                    <b className={warn ? 'text-[#C0392B]' : ''}>
                      {report.reported_profile?.nickname ?? '(不明)'}
                    </b>
                    {report.reported_profile?.status === 'suspended' ? (
                      <span className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-xs">凍結中</span>
                    ) : null}
                  </span>
                  <span className="rounded bg-[#C0392B] px-2 py-0.5 text-xs font-bold text-white">
                    {report.reason}
                  </span>
                  {warn ? (
                    <span className="rounded border border-[#C0392B] px-2 py-0.5 text-xs font-bold text-[#C0392B]">
                      ⚠ このユーザーへの未対応通報が{count}件
                    </span>
                  ) : null}
                </div>
                {report.detail ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{report.detail}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-3">
                  <form action={markActioned}>
                    <input type="hidden" name="id" value={report.id} />
                    <button
                      type="submit"
                      className="rounded bg-green-700 px-4 py-2 text-sm font-bold text-white hover:bg-green-800"
                    >
                      対応済みにする
                    </button>
                  </form>
                  <form action={actionAndSuspend}>
                    <input type="hidden" name="id" value={report.id} />
                    <input type="hidden" name="reported" value={report.reported} />
                    <ConfirmButton
                      message={`${report.reported_profile?.nickname ?? 'このユーザー'}を凍結しますか？\n凍結すると検索に表示されず、メッセージも送信できなくなります。`}
                      className="rounded bg-[#C0392B] px-4 py-2 text-sm font-bold text-white hover:bg-[#96281B]"
                    >
                      対応済み + ユーザーを凍結
                    </ConfirmButton>
                  </form>
                  <form action={dismissReport}>
                    <input type="hidden" name="id" value={report.id} />
                    <button
                      type="submit"
                      className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      棄却
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="mt-10 mb-3 text-lg font-bold">対応履歴（直近20件）</h2>
      <table className="w-full rounded-lg border border-gray-200 bg-white text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="px-3 py-2">通報日時</th>
            <th className="px-3 py-2">通報者</th>
            <th className="px-3 py-2">対象</th>
            <th className="px-3 py-2">理由</th>
            <th className="px-3 py-2">結果</th>
          </tr>
        </thead>
        <tbody>
          {history.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-gray-400">
                まだ対応履歴がありません。
              </td>
            </tr>
          ) : (
            history.map((report) => (
              <tr key={report.id} className="border-b border-gray-100">
                <td className="px-3 py-2 text-gray-500">{formatDate(report.created_at)}</td>
                <td className="px-3 py-2">{report.reporter_profile?.nickname ?? '-'}</td>
                <td className="px-3 py-2">{report.reported_profile?.nickname ?? '-'}</td>
                <td className="px-3 py-2">{report.reason}</td>
                <td className="px-3 py-2">
                  <span
                    className={report.status === 'actioned' ? 'text-green-700' : 'text-gray-500'}
                  >
                    {STATUS_LABEL[report.status] ?? report.status}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
