import { findFraudWords } from '@hapimari/shared';
import { ConfirmButton } from '@/components/confirm-button';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { suspendUser } from '../users/actions';

export const dynamic = 'force-dynamic';

interface FlaggedRow {
  id: string;
  sender: string;
  body: string;
  created_at: string | null;
  sender_profile: { nickname: string; status: string } | null;
  match: { user_a: string; user_b: string } | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

/**
 * flaggedメッセージ一覧（docs/design/M3_design.md §6.3）
 * R8: 詐欺ワードを含むメッセージはDBトリガで flagged=true になる。
 * 検知語は表示時に findFraudWords()（TS辞書）で再計算して表示する。
 */
export default async function FlaggedPage() {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select(
      `id, sender, body, created_at,
       sender_profile:profiles!messages_sender_fkey(nickname, status),
       match:matches!messages_match_id_fkey(user_a, user_b)`,
    )
    .eq('flagged', true)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return <p className="text-red-600">読み込みエラー: {error.message}</p>;
  }

  const rows = (data ?? []) as unknown as FlaggedRow[];

  // 受信者（マッチの相手）のニックネームをまとめて取得
  const receiverIds = [
    ...new Set(
      rows
        .map((r) =>
          r.match ? (r.match.user_a === r.sender ? r.match.user_b : r.match.user_a) : null,
        )
        .filter((x): x is string => !!x),
    ),
  ];
  let receiverNames: Record<string, string> = {};
  if (receiverIds.length > 0) {
    const { data: receivers } = await supabaseAdmin
      .from('profiles')
      .select('id, nickname')
      .in('id', receiverIds);
    receiverNames = Object.fromEntries((receivers ?? []).map((p) => [p.id, p.nickname]));
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">flaggedメッセージ（詐欺ワード検知）</h1>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-gray-500">
          検知されたメッセージはありません。
        </p>
      ) : (
        <table className="w-full rounded-lg border border-gray-200 bg-white text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-3 py-2">日時</th>
              <th className="px-3 py-2">送信者</th>
              <th className="px-3 py-2">受信者</th>
              <th className="px-3 py-2">本文</th>
              <th className="px-3 py-2">検知語</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const receiverId = row.match
                ? row.match.user_a === row.sender
                  ? row.match.user_b
                  : row.match.user_a
                : null;
              const words = findFraudWords(row.body);
              return (
                <tr key={row.id} className="border-b border-gray-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                    {formatDate(row.created_at)}
                  </td>
                  <td className="px-3 py-2 font-bold">
                    {row.sender_profile?.nickname ?? '(不明)'}
                    {row.sender_profile?.status === 'suspended' ? (
                      <span className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-normal">
                        凍結中
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {receiverId ? (receiverNames[receiverId] ?? '(不明)') : '-'}
                  </td>
                  <td className="max-w-md px-3 py-2 text-gray-700">
                    <span className="line-clamp-3 whitespace-pre-wrap">{row.body}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {words.map((w) => (
                        <span
                          key={w}
                          className="rounded bg-[#C0392B] px-1.5 py-0.5 text-xs font-bold text-white"
                        >
                          {w}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {row.sender_profile?.status === 'active' ? (
                      <form action={suspendUser}>
                        <input type="hidden" name="id" value={row.sender} />
                        <ConfirmButton
                          message={`送信者「${row.sender_profile?.nickname ?? ''}」を凍結しますか？`}
                          className="whitespace-nowrap rounded border border-[#C0392B] px-3 py-1.5 text-xs font-bold text-[#C0392B] hover:bg-red-50"
                        >
                          送信者を凍結
                        </ConfirmButton>
                      </form>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-gray-400">
        新しい順に50件まで表示します。通報とあわせた対応は「通報対応」ページに集約しています。
      </p>
    </div>
  );
}
