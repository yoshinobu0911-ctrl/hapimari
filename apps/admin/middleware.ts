import { type NextRequest, NextResponse } from 'next/server';
import {
  allowsInsecureWithoutPassword,
  isUnverifiedHttpsInProduction,
  isValidBasicAuth,
} from './lib/basic-auth';

// 管理画面全体をBasic認証で保護する（監査P0-1対応 + レビュー2回目 must#7 対応）。
// ADMIN_PASSWORD 未設定時は環境を問わず503で全遮断する。
// ローカル開発で認証を外したい場合のみ ADMIN_ALLOW_INSECURE=1 を明示する
// （NODE_ENV の判定ミスや未設定ビルドで本番が素通しになる事故を防ぐ）。
// 認証の判定本体は lib/basic-auth.ts（next/headers に依存しない純粋処理・I18）
const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

/** 本番のレスポンスに HSTS を付与して返す（Basic認証はhttpsが前提） */
function withSecurityHeaders(response: NextResponse): NextResponse {
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', HSTS_VALUE);
  }
  return response;
}

export function middleware(request: NextRequest) {
  // 本番で HTTPS と確認できない要求は拒否（Basic認証のパスワードを平文で流させない）。
  // I35: 旧実装はヘッダ欠落を素通ししていた。欠落も拒否する（前提は lib/basic-auth.ts の説明）
  if (
    isUnverifiedHttpsInProduction(request.headers.get('x-forwarded-proto'), process.env.NODE_ENV)
  ) {
    return withSecurityHeaders(new NextResponse('httpsでアクセスしてください。', { status: 403 }));
  }

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    // 明示フラグが無い限り、開発環境でも素通しにしない
    if (allowsInsecureWithoutPassword(process.env)) {
      return NextResponse.next();
    }
    return withSecurityHeaders(
      new NextResponse(
        'ADMIN_PASSWORD が未設定のため管理画面を無効化しています。ローカル開発では ADMIN_ALLOW_INSECURE=1 を設定してください。',
        { status: 503 },
      ),
    );
  }

  if (isValidBasicAuth(request.headers.get('authorization'), password)) {
    return withSecurityHeaders(NextResponse.next());
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
