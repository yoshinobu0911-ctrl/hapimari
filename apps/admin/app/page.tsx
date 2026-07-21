import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const [total, males, females, pending, pendingPhotos, matches, openReports, flagged] =
    await Promise.all([
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
      supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('gender', 'male'),
      supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('gender', 'female'),
      supabaseAdmin
        .from('verifications')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabaseAdmin
        .from('photo_reviews')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabaseAdmin.from('matches').select('*', { count: 'exact', head: true }),
      supabaseAdmin
        .from('reports')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open'),
      supabaseAdmin
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('flagged', true),
    ]);

  const cards = [
    {
      label: '登録ユーザー',
      value: `${total.count ?? 0}名（男${males.count ?? 0} / 女${females.count ?? 0}）`,
      highlight: false,
    },
    {
      label: '審査待ちの書類',
      value: `${pending.count ?? 0}件`,
      highlight: (pending.count ?? 0) > 0,
    },
    {
      label: '審査待ちの写真',
      value: `${pendingPhotos.count ?? 0}件`,
      highlight: (pendingPhotos.count ?? 0) > 0,
    },
    { label: 'マッチ数', value: `${matches.count ?? 0}組`, highlight: false },
    {
      label: '未対応の通報',
      value: `${openReports.count ?? 0}件`,
      highlight: (openReports.count ?? 0) > 0,
    },
    {
      label: 'flaggedメッセージ',
      value: `${flagged.count ?? 0}件`,
      highlight: (flagged.count ?? 0) > 0,
    },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">ダッシュボード</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {cards.map((card) => (
          <div
            key={card.label}
            className={`rounded-lg border bg-white p-4 ${card.highlight ? 'border-[#C0392B]' : 'border-gray-200'}`}
          >
            <div className="text-sm text-gray-500">{card.label}</div>
            <div className={`mt-1 text-xl font-bold ${card.highlight ? 'text-[#C0392B]' : ''}`}>
              {card.value}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-sm text-gray-500">
        日次集計は毎日0:05（JST）に自動実行されます。月次の公開用JSONは「透明性レポート」から生成できます。
      </p>
    </div>
  );
}
