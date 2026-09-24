/**
 * 管理画面の Basic 認証の純粋処理（I18: middleware.ts と admin-auth.ts の二重実装を1か所へ）。
 *
 * middleware（Edge ランタイム）からも import するため、next/headers などサーバー専用の
 * モジュールには依存しない。判定だけを行い、応答の組み立ては呼び出し側が行う。
 */

export const ADMIN_USER = 'admin';

/** 長さの差も含めて一定時間で比較する（タイミング攻撃対策） */
export function timingSafeEqual(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a);
  const bytesB = new TextEncoder().encode(b);
  let diff = bytesA.length ^ bytesB.length;
  const len = Math.max(bytesA.length, bytesB.length);
  for (let i = 0; i < len; i++) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

/** Authorization ヘッダが ADMIN_USER と password の Basic 認証として正しいか */
export function isValidBasicAuth(authorization: string | null, password: string): boolean {
  if (!authorization?.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = atob(authorization.slice('Basic '.length));
  } catch {
    return false; // base64 として不正
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);
  // 両方とも必ず比較する（片方の不一致で早期に抜けない）
  const userOk = timingSafeEqual(user, ADMIN_USER);
  const passOk = timingSafeEqual(pass, password);
  return userOk && passOk;
}

/** ADMIN_PASSWORD 未設定でも通してよいか（明示フラグ＋非 production の両方が揃うときだけ） */
export function allowsInsecureWithoutPassword(env: {
  ADMIN_ALLOW_INSECURE?: string;
  NODE_ENV?: string;
}): boolean {
  return env.ADMIN_ALLOW_INSECURE === '1' && env.NODE_ENV !== 'production';
}
