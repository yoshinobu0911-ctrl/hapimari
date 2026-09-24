import { headers } from 'next/headers';
// 判定本体は lib/basic-auth.ts（middleware と共用・I18）
import { allowsInsecureWithoutPassword, isValidBasicAuth } from './basic-auth';

/**
 * Server Action 内の認証再検証（M6.5 対応2: middleware との二重化）。
 * middleware が全リクエストを守るが、設定ミスや matcher 漏れに備えて
 * 変更系アクションの冒頭でも同じ Basic 認証を検証する。
 */
export async function assertAdminAuth(): Promise<void> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    // middleware と同じ方針: 明示フラグ + 非production の両方が揃わない限り拒否する
    if (allowsInsecureWithoutPassword(process.env)) {
      return;
    }
    throw new Error('ADMIN_PASSWORD が未設定のため操作を拒否しました。');
  }
  if (isValidBasicAuth((await headers()).get('authorization'), password)) return;
  throw new Error('認証されていない操作です。');
}
