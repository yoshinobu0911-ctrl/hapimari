import { ConfirmButton } from '@/components/confirm-button';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { runRetentionJob } from './actions';

export const dynamic = 'force-dynamic';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

/**
 * 保持ポリシーの管理ページ（docs/legal/privacy_policy.md §6）
 *
 * 退会から90日を過ぎた利用者を匿名化し、写真・本人確認書類の実体を削除する。
 * M7でBEサーバーを立てたら日次cronに移す。それまではこの画面から手動実行する。
 */
export default async function RetentionPage() {
  const [{ data: pendingAnon }, { data: queued }, { data: anonymized }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, withdrawn_at')
      .eq('status', 'withdrawn')
      .is('anonymized_at', null)
      .order('withdrawn_at', { ascending: true }),
    supabaseAdmin.from('file_deletion_queue').select('bucket_id, path').is('deleted_at', null),
    supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: false })
      .not('anonymized_at', 'is', null),
  ]);

  const now = Date.now();
  const dueForAnonymization = (pendingAnon ?? []).filter(
    (p) => p.withdrawn_at && now - new Date(p.withdrawn_at).getTime() > 90 * 24 * 60 * 60 * 1000,
  );

  async function run() {
    'use server';
    await runRetentionJob();
  }

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>データ保持ポリシーの実行</h1>
      <p style={{ color: '#555', lineHeight: 1.7, marginBottom: 24 }}>
        退会から<strong>90日</strong>を過ぎた方の個人情報を削除し、アルゴリズム学習用の
        特徴量だけを匿名の記録として残します。写真と本人確認書類は実体ごと削除されます。 この操作は
        <strong>取り消せません</strong>。
      </p>

      <section style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <Card label="退会済み（未匿名化）" value={(pendingAnon ?? []).length} />
        <Card label="90日経過＝今回の対象" value={dueForAnonymization.length} highlight />
        <Card label="削除待ちファイル" value={(queued ?? []).length} />
        <Card label="匿名化済み（累計）" value={(anonymized ?? []).length} />
      </section>

      <form action={run}>
        <ConfirmButton
          message={`${dueForAnonymization.length}件を匿名化し、${(queued ?? []).length}件のファイルを削除します。取り消せません。実行しますか？`}
        >
          保持ポリシーを実行する
        </ConfirmButton>
      </form>

      <h2 style={{ fontSize: 18, marginTop: 32, marginBottom: 8 }}>退会済みの一覧</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
            <th style={cell}>退会日時</th>
            <th style={cell}>経過日数</th>
            <th style={cell}>状態</th>
          </tr>
        </thead>
        <tbody>
          {(pendingAnon ?? []).map((p) => {
            const days = p.withdrawn_at
              ? Math.floor((now - new Date(p.withdrawn_at).getTime()) / (24 * 60 * 60 * 1000))
              : null;
            return (
              <tr key={p.id}>
                <td style={cell}>{formatDate(p.withdrawn_at)}</td>
                <td style={cell}>{days === null ? '-' : `${days}日`}</td>
                <td style={cell}>
                  {days !== null && days > 90 ? '⚠️ 90日経過（対象）' : '保持期間中'}
                </td>
              </tr>
            );
          })}
          {(pendingAnon ?? []).length === 0 && (
            <tr>
              <td style={cell} colSpan={3}>
                退会済みの利用者はいません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}

const cell: React.CSSProperties = { border: '1px solid #ddd', padding: '8px 12px' };

function Card({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      style={{
        border: `1px solid ${highlight ? '#d97706' : '#ddd'}`,
        borderRadius: 8,
        padding: '12px 20px',
        minWidth: 160,
        background: highlight ? '#fffbeb' : '#fff',
      }}
    >
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
