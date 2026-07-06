import { supabaseAdmin } from '@/lib/supabase-admin';
import { approveVerification, rejectVerification } from './actions';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  identity: '本人確認',
  income: '収入証明',
  single_cert: '独身証明',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '審査待ち',
  approved: '承認',
  rejected: '却下',
};

interface VerificationRow {
  id: string;
  kind: string;
  status: string;
  document_url: string;
  reject_reason: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  profiles: { nickname: string; gender: string } | null;
}

async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabaseAdmin.storage.from('verifications').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

export default async function VerificationsPage() {
  const { data, error } = await supabaseAdmin
    .from('verifications')
    .select(
      'id, kind, status, document_url, reject_reason, created_at, reviewed_at, profiles(nickname, gender)',
    )
    .order('created_at', { ascending: true });

  if (error) {
    return <p className="text-red-600">読み込みエラー: {error.message}</p>;
  }

  const rows = (data ?? []) as unknown as VerificationRow[];
  const pending = rows.filter((r) => r.status === 'pending');
  const reviewed = rows
    .filter((r) => r.status !== 'pending')
    .reverse()
    .slice(0, 20);

  const pendingWithUrls = await Promise.all(
    pending.map(async (r) => ({ ...r, imageUrl: await signedUrl(r.document_url) })),
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">本人確認審査キュー</h1>

      {pendingWithUrls.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-gray-500">
          審査待ちの書類はありません。
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {pendingWithUrls.map((row) => (
            <div key={row.id} className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4">
              <div className="w-48 shrink-0">
                {row.imageUrl ? (
                  // biome-ignore lint/performance/noImgElement: 有効期限つき署名URLのためnext/imageの最適化対象にしない（内部管理画面専用）
                  <img
                    src={row.imageUrl}
                    alt="提出書類"
                    className="w-48 rounded border border-gray-200 object-contain"
                  />
                ) : (
                  <div className="flex h-32 w-48 items-center justify-center rounded bg-gray-100 text-sm text-gray-400">
                    画像を取得できません
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-3">
                  <span className="rounded bg-[#C0392B] px-2 py-0.5 text-xs font-bold text-white">
                    {KIND_LABEL[row.kind] ?? row.kind}
                  </span>
                  <span className="font-bold">
                    {row.profiles?.nickname ?? '(不明なユーザー)'}
                    <span className="ml-1 font-normal text-gray-500">
                      （{row.profiles?.gender === 'male' ? '男性' : '女性'}）
                    </span>
                  </span>
                  <span className="text-sm text-gray-500">提出: {formatDate(row.created_at)}</span>
                </div>
                <div className="mt-auto flex items-end gap-3">
                  <form action={approveVerification}>
                    <input type="hidden" name="id" value={row.id} />
                    <button
                      type="submit"
                      className="rounded bg-green-700 px-4 py-2 text-sm font-bold text-white hover:bg-green-800"
                    >
                      承認する
                    </button>
                  </form>
                  <form action={rejectVerification} className="flex items-end gap-2">
                    <input type="hidden" name="id" value={row.id} />
                    <label className="flex flex-col text-xs text-gray-500">
                      却下理由（ユーザーに表示されます）
                      <input
                        type="text"
                        name="reason"
                        placeholder="例: 画像が不鮮明です"
                        className="mt-1 w-64 rounded border border-gray-300 px-2 py-2 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded border border-[#C0392B] px-4 py-2 text-sm font-bold text-[#C0392B] hover:bg-red-50"
                    >
                      却下する
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-10 mb-3 text-lg font-bold">最近の審査結果（直近20件）</h2>
      <table className="w-full rounded-lg border border-gray-200 bg-white text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="px-3 py-2">ユーザー</th>
            <th className="px-3 py-2">種別</th>
            <th className="px-3 py-2">結果</th>
            <th className="px-3 py-2">却下理由</th>
            <th className="px-3 py-2">審査日時</th>
          </tr>
        </thead>
        <tbody>
          {reviewed.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-gray-400">
                まだ審査履歴がありません。
              </td>
            </tr>
          ) : (
            reviewed.map((row) => (
              <tr key={row.id} className="border-b border-gray-100">
                <td className="px-3 py-2">{row.profiles?.nickname ?? '-'}</td>
                <td className="px-3 py-2">{KIND_LABEL[row.kind] ?? row.kind}</td>
                <td className="px-3 py-2">
                  <span className={row.status === 'approved' ? 'text-green-700' : 'text-[#C0392B]'}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500">{row.reject_reason ?? '-'}</td>
                <td className="px-3 py-2 text-gray-500">{formatDate(row.reviewed_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
