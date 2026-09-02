import { type NextRequest, NextResponse } from 'next/server';

// 管理画面全体をBasic認証で保護する（監査P0-1対応 + レビュー2回目 must#7 対応）。
// ADMIN_PASSWORD 未設定時は環境を問わず503で全遮断する。
// ローカル開発で認証を外したい場合のみ ADMIN_ALLOW_INSECURE=1 を明示する
// （NODE_ENV の判定ミスや未設定ビルドで本番が素通しになる事故を防ぐ）。
const ADMIN_USER = 'admin';
const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

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

/** 本番のレスポンスに HSTS を付与して返す（Basic認証はhttpsが前提） */
function withSecurityHeaders(response: NextResponse): NextResponse {
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', HSTS_VALUE);
  }
  return response;
}

export function middleware(request: NextRequest) {
  // 本番でhttpアクセスは拒否（Basic認証のパスワードを平文で流させない）
  const proto = request.headers.get('x-forwarded-proto');
  if (process.env.NODE_ENV === 'production' && proto !== null && proto !== 'https') {
    return withSecurityHeaders(new NextResponse('httpsでアクセスしてください。', { status: 403 }));
  }

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    // 明示フラグが無い限り、開発環境でも素通しにしない
    if (process.env.ADMIN_ALLOW_INSECURE === '1' && process.env.NODE_ENV !== 'production') {
      return NextResponse.next();
    }
    return withSecurityHeaders(
      new NextResponse(
        'ADMIN_PASSWORD が未設定のため管理画面を無効化しています。ローカル開発では ADMIN_ALLOW_INSECURE=1 を設定してください。',
        { status: 503 },
      ),
    );
  }

  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Basic ')) {
    const decoded = atob(authorization.slice('Basic '.length));
    const separator = decoded.indexOf(':');
    const user = decoded.slice(0, separator);
    const pass = decoded.slice(separator + 1);
    if (timingSafeEqual(user, ADMIN_USER) && timingSafeEqual(pass, password)) {
      return withSecurityHeaders(NextResponse.next());
    }
  }

  return withSecurityHeaders(
    new NextResponse('認証が必要です。', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="hapimari-admin"' },
    }),
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
