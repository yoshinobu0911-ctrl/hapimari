import { describe, expect, it } from 'vitest';
import {
  allowsInsecureWithoutPassword,
  isValidBasicAuth,
  timingSafeEqual,
} from '../../../apps/admin/lib/basic-auth';

// 管理画面の Basic 認証の純粋処理（I18。apps/admin にはテスト実行器が無いため shared から検査する）
const basic = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`;

describe('isValidBasicAuth（I18）', () => {
  it('admin と正しいパスワードだけ通る', () => {
    expect(isValidBasicAuth(basic('admin', 's3cret'), 's3cret')).toBe(true);
    expect(isValidBasicAuth(basic('admin', 's3cre'), 's3cret')).toBe(false);
    expect(isValidBasicAuth(basic('root', 's3cret'), 's3cret')).toBe(false);
    expect(isValidBasicAuth(basic('admin', ''), 's3cret')).toBe(false);
  });

  it('パスワードに : を含んでも最初の : で区切る', () => {
    expect(isValidBasicAuth(basic('admin', 'a:b:c'), 'a:b:c')).toBe(true);
  });

  it('ヘッダ無し・Basic 以外・不正な base64・区切り無しは false（例外にしない）', () => {
    expect(isValidBasicAuth(null, 's3cret')).toBe(false);
    expect(isValidBasicAuth('Bearer x', 's3cret')).toBe(false);
    expect(isValidBasicAuth('Basic %%%', 's3cret')).toBe(false);
    expect(isValidBasicAuth(`Basic ${btoa('admins3cret')}`, 's3cret')).toBe(false);
  });
});

describe('timingSafeEqual / allowsInsecureWithoutPassword（I18）', () => {
  it('長さが違っても一致しない', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('パスワード未設定で通すのは「明示フラグ」かつ「非 production」のときだけ', () => {
    expect(
      allowsInsecureWithoutPassword({ ADMIN_ALLOW_INSECURE: '1', NODE_ENV: 'development' }),
    ).toBe(true);
    expect(
      allowsInsecureWithoutPassword({ ADMIN_ALLOW_INSECURE: '1', NODE_ENV: 'production' }),
    ).toBe(false);
    expect(allowsInsecureWithoutPassword({ NODE_ENV: 'development' })).toBe(false);
    expect(allowsInsecureWithoutPassword({ ADMIN_ALLOW_INSECURE: 'true' })).toBe(false);
  });
});
