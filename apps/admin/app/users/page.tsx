import { calcAge } from '@hapimari/shared';
import { ConfirmButton } from '@/components/confirm-button';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { reactivateUser, suspendUser } from './actions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  active: '有効',
  suspended: '凍結中',
  withdrawn: '退会',
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

/**
 * ユーザー検索・凍結（docs/design/M3_design.md §6.2）
 * ニックネーム部分一致で検索（Next 16 では searchParams は Promise）。
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const keyword = (q ?? '').trim();

  let query = supabaseAdmin
    .from('profiles')
    .select('id, nickname, gender, birth_date, prefecture, is_verified, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (keyword) query = query.ilike('nickname', `%${keyword}%`);

  const { data, error } = await query;
  if (error) {
    return <p className="text-red-600">読み込みエラー: {error.message}</p>;
  }
  const users = data ?? [];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">ユーザー検索・凍結</h1>

      <form method="GET" className="mb-4 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={keyword}
          placeholder="ニックネームで検索（部分一致）"
          className="w-72 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded bg-[#C0392B] px-4 py-2 text-sm font-bold text-white hover:bg-[#96281B]"
        >
          検索
        </button>
      </form>

      <table className="w-full rounded-lg border border-gray-200 bg-white text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="px-3 py-2">ニックネーム</th>
            <th className="px-3 py-2">性別</th>
            <th className="px-3 py-2">年齢</th>
            <th className="px-3 py-2">都道府県</th>
            <th className="px-3 py-2">認証</th>
            <th className="px-3 py-2">状態</th>
            <th className="px-3 py-2">登録日</th>
            <th className="px-3 py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-3 py-4 text-gray-400">
                {keyword ? `「${keyword}」に一致するユーザーはいません。` : 'ユーザーがいません。'}
              </td>
            </tr>
          ) : (
            users.map((user) => (
              <tr key={user.id} className="border-b border-gray-100">
                <td className="px-3 py-2 font-bold">{user.nickname}</td>
                <td className="px-3 py-2">{user.gender === 'male' ? '男性' : '女性'}</td>
                <td className="px-3 py-2">{calcAge(user.birth_date)}歳</td>
                <td className="px-3 py-2">{user.prefecture}</td>
                <td className="px-3 py-2">
                  {user.is_verified ? (
                    <span className="text-green-700">✓ 本人確認済み</span>
                  ) : (
                    <span className="text-gray-400">未確認</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      user.status === 'active'
                        ? 'text-green-700'
                        : user.status === 'suspended'
                          ? 'font-bold text-[#C0392B]'
                          : 'text-gray-500'
                    }
                  >
                    {STATUS_LABEL[user.status] ?? user.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500">{formatDate(user.created_at)}</td>
                <td className="px-3 py-2">
                  {user.status === 'active' ? (
                    <form action={suspendUser}>
                      <input type="hidden" name="id" value={user.id} />
                      <ConfirmButton
                        message={`${user.nickname}を凍結しますか？\n凍結すると検索に表示されず、メッセージも送信できなくなります。`}
                        className="rounded border border-[#C0392B] px-3 py-1.5 text-xs font-bold text-[#C0392B] hover:bg-red-50"
                      >
                        凍結
                      </ConfirmButton>
                    </form>
                  ) : user.status === 'suspended' ? (
                    <form action={reactivateUser}>
                      <input type="hidden" name="id" value={user.id} />
                      <ConfirmButton
                        message={`${user.nickname}の凍結を解除しますか？`}
                        className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        凍結解除
                      </ConfirmButton>
                    </form>
                  ) : (
                    <span className="text-xs text-gray-400">-</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-gray-400">最新100件まで表示します。</p>
    </div>
  );
}
