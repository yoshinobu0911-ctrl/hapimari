import { type NextRequest, NextResponse } from 'next/server';

// 管理画面全体をBasic認証で保護する（監査P0-1対応の最小実装）。
// ADMIN_PASSWORD 未設定時: 開発中は素通し、本番は503で全遮断（保護なしで公開させない）。
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

export function middleware(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('ADMIN_PASSWORD が未設定のため管理画面を無効化しています。', {
        status: 503,
      });
    }
    return NextResponse.next();
  }

  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Basic ')) {
    const decoded = atob(authorization.slice('Basic '.length));
    const separator = decoded.indexOf(':');
    const user = decoded.slice(0, separator);
    const pass = decoded.slice(separator + 1);
    if (timingSafeEqual(user, ADMIN_USER) && timingSafeEqual(pass, password)) {
      return NextResponse.next();
    }
  }

  return new NextResponse('認証が必要です。', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="hapimari-admin"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
