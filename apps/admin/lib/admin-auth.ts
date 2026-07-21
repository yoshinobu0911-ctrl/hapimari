import { headers } from 'next/headers';

/**
 * Server Action 内の認証再検証（M6.5 対応2: middleware との二重化）。
 * middleware が全リクエストを守るが、設定ミスや matcher 漏れに備えて
 * 変更系アクションの冒頭でも同じ Basic 認証を検証する。
 */
const ADMIN_USER = 'admin';

function timingSafeEqual(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a);
  const bytesB = new TextEncoder().encode(b);
  let diff = bytesA.length ^ bytesB.length;
  const len = Math.max(bytesA.length, bytesB.length);
  for (let i = 0; i < len; i++) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

export async function assertAdminAuth(): Promise<void> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ADMIN_PASSWORD が未設定のため操作を拒否しました。');
    }
    return; // 開発中は素通し（middleware と同じ方針）
  }
  const authorization = (await headers()).get('authorization');
  if (authorization?.startsWith('Basic ')) {
    const decoded = atob(authorization.slice('Basic '.length));
    const separator = decoded.indexOf(':');
    const user = decoded.slice(0, separator);
    const pass = decoded.slice(separator + 1);
    if (timingSafeEqual(user, ADMIN_USER) && timingSafeEqual(pass, password)) return;
  }
  throw new Error('認証されていない操作です。');
}
