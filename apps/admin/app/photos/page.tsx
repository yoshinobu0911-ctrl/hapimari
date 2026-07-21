import { aiModerationAvailable } from '@/lib/photo-ai';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { approvePhoto, rejectPhoto } from './actions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  pending: '審査待ち',
  approved: '承認',
  rejected: '却下',
};

const AI_LABEL: Record<string, string> = {
  ok: 'AI: 問題なし',
  ng: 'AI: 不適切の疑い',
  unsure: 'AI: 要確認',
};

interface PhotoReviewRow {
  path: string;
  user_id: string;
  status: string;
  ai_verdict: string | null;
  ai_detail: string | null;
  created_at: string | null;
  reviewed_at: string | null;
}

function isExternalUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

async function signedUrl(path: string): Promise<string | null> {
  if (isExternalUrl(path)) return path; // seedの外部URLはそのまま表示
  const { data } = await supabaseAdmin.storage.from('photos').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

export default async function PhotosPage() {
  const { data, error } = await supabaseAdmin
    .from('photo_reviews')
    .select('path, user_id, status, ai_verdict, ai_detail, created_at, reviewed_at')
    .order('created_at', { ascending: true });

  if (error) {
    return <p className="text-red-600">読み込みエラー: {error.message}</p>;
  }

  const rows = (data ?? []) as PhotoReviewRow[];
  const pending = rows.filter((r) => r.status === 'pending');
  const reviewed = rows
    .filter((r) => r.status !== 'pending')
    .reverse()
    .slice(0, 20);

  // 表示名の解決（審査対象ユーザーのニックネーム）
  const userIds = [...new Set(pending.concat(reviewed).map((r) => r.user_id))];
  const { data: profileRows } = userIds.length
    ? await supabaseAdmin.from('profiles').select('id, nickname, gender').in('id', userIds)
    : { data: [] };
  const nicknames = new Map((profileRows ?? []).map((p) => [p.id, p]));

  const pendingWithUrls = await Promise.all(
    pending.map(async (r) => ({ ...r, imageUrl: await signedUrl(r.path) })),
  );

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">写真審査キュー</h1>
      <p className="mb-6 text-sm text-gray-500">
        新しくアップロードされた写真は、ここで承認されるまで本人以外には表示されません。
        {aiModerationAvailable()
          ? ' AI画像解析が有効です（AI判定は参考情報・最終判断は人力）。'
          : ' AI画像解析は未接続です（モデレーションAPIキーの設定後に有効化・現在は人力のみ）。'}
      </p>

      {pendingWithUrls.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-gray-500">
          審査待ちの写真はありません。
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {pendingWithUrls.map((row) => {
            const profile = nicknames.get(row.user_id);
            return (
              <div
                key={row.path}
                className="flex gap-4 rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="w-48 shrink-0">
                  {row.imageUrl ? (
                    // biome-ignore lint/performance/noImgElement: 有効期限つき署名URLのためnext/imageの最適化対象にしない（内部管理画面専用）
                    <img
                      src={row.imageUrl}
                      alt="審査対象の写真"
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
                    <span className="font-bold">
                      {profile?.nickname ?? '(不明なユーザー)'}
                      <span className="ml-1 font-normal text-gray-500">
                        （{profile?.gender === 'male' ? '男性' : '女性'}）
                      </span>
                    </span>
                    <span className="text-sm text-gray-500">
                      アップロード: {formatDate(row.created_at)}
                    </span>
                    {row.ai_verdict ? (
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-bold ${
                          row.ai_verdict === 'ok'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                        title={row.ai_detail ?? ''}
                      >
                        {AI_LABEL[row.ai_verdict] ?? row.ai_verdict}
                      </span>
                    ) : (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        AI未判定
                      </span>
                    )}
                  </div>
                  <div className="break-all text-xs text-gray-400">{row.path}</div>
                  <div className="mt-auto flex items-end gap-3">
                    <form action={approvePhoto}>
                      <input type="hidden" name="path" value={row.path} />
                      <button
                        type="submit"
                        className="rounded bg-green-700 px-4 py-2 text-sm font-bold text-white hover:bg-green-800"
                      >
                        承認する
                      </button>
                    </form>
                    <form action={rejectPhoto}>
                      <input type="hidden" name="path" value={row.path} />
                      <input type="hidden" name="userId" value={row.user_id} />
                      <button
                        type="submit"
                        className="rounded border border-[#C0392B] px-4 py-2 text-sm font-bold text-[#C0392B] hover:bg-red-50"
                      >
                        却下する（本人の写真から外す）
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="mt-10 mb-3 text-lg font-bold">最近の審査結果（直近20件）</h2>
      <table className="w-full rounded-lg border border-gray-200 bg-white text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="px-3 py-2">ユーザー</th>
            <th className="px-3 py-2">結果</th>
            <th className="px-3 py-2">AI判定</th>
            <th className="px-3 py-2">審査日時</th>
          </tr>
        </thead>
        <tbody>
          {reviewed.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-gray-400">
                まだ審査履歴がありません。
              </td>
            </tr>
          ) : (
            reviewed.map((row) => (
              <tr key={row.path} className="border-b border-gray-100">
                <td className="px-3 py-2">{nicknames.get(row.user_id)?.nickname ?? '-'}</td>
                <td className="px-3 py-2">
                  <span className={row.status === 'approved' ? 'text-green-700' : 'text-[#C0392B]'}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {row.ai_verdict ? (AI_LABEL[row.ai_verdict] ?? row.ai_verdict) : '-'}
                </td>
                <td className="px-3 py-2 text-gray-500">{formatDate(row.reviewed_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
