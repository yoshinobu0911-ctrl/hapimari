import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'ハピマリ 管理画面',
  description: 'ハピマリ運営用の管理画面',
};

const NAV_ITEMS = [
  { href: '/', label: 'ダッシュボード' },
  { href: '/verifications', label: '本人確認審査' },
  { href: '/reports', label: '通報対応' },
  { href: '/users', label: 'ユーザー検索・凍結' },
  { href: '/flagged', label: 'flaggedメッセージ' },
  { href: '/transparency', label: '透明性レポート' },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full bg-gray-50 text-gray-900">
        <div className="flex min-h-screen">
          <aside className="w-56 shrink-0 border-r border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-4 py-4">
              <div className="text-lg font-bold text-[#C0392B]">ハピマリ 管理</div>
              <div className="mt-1 text-xs text-gray-500">local / service_role</div>
            </div>
            <nav className="flex flex-col gap-1 p-2">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-3 py-2 text-sm hover:bg-gray-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
