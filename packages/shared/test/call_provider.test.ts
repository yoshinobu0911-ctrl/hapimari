import { describe, expect, it } from 'vitest';
import {
  callSetupFailureMessage,
  formatCallDuration,
  remainingCallSeconds,
} from '../src/call-provider';
import { CALL_MAX_DURATION_SECONDS } from '../src/constants';

describe('remainingCallSeconds（30分=1800秒の自動切断境界）', () => {
  it('開始直後は1800秒', () => {
    expect(remainingCallSeconds(0, 0)).toBe(CALL_MAX_DURATION_SECONDS);
    expect(CALL_MAX_DURATION_SECONDS).toBe(1800);
  });

  it('1799秒経過で残り1秒（まだ切断しない）', () => {
    expect(remainingCallSeconds(0, 1_799_000)).toBe(1);
  });

  it('1800秒経過ちょうどで残り0（自動切断）', () => {
    expect(remainingCallSeconds(0, 1_800_000)).toBe(0);
  });

  it('1800秒超過でも負値にならない', () => {
    expect(remainingCallSeconds(0, 2_000_000)).toBe(0);
  });

  it('時計逆行（now < started）でも上限を超えない', () => {
    expect(remainingCallSeconds(10_000, 0)).toBe(CALL_MAX_DURATION_SECONDS);
  });

  it('上限は引数で変更できる（Agora実装等の将来用）', () => {
    expect(remainingCallSeconds(0, 30_000, 60)).toBe(30);
  });
});

describe('formatCallDuration', () => {
  it('0:00 / 0:59 / 1:00 / 14:59 / 15:00 / 29:59 / 30:00 の表記', () => {
    expect(formatCallDuration(0)).toBe('0:00');
    expect(formatCallDuration(59)).toBe('0:59');
    expect(formatCallDuration(60)).toBe('1:00');
    expect(formatCallDuration(899)).toBe('14:59');
    expect(formatCallDuration(900)).toBe('15:00');
    expect(formatCallDuration(1799)).toBe('29:59');
    expect(formatCallDuration(1800)).toBe('30:00');
  });

  it('負値・小数は安全に丸める', () => {
    expect(formatCallDuration(-5)).toBe('0:00');
    expect(formatCallDuration(61.9)).toBe('1:01');
  });
});

describe('callSetupFailureMessage（agora-token の失敗応答から案内文を取り出す）', () => {
  it('規約どおりの失敗応答は message をそのまま返す', () => {
    expect(
      callSetupFailureMessage({
        ok: false,
        error: 'not_verified',
        message: '本人確認の完了後にご利用いただけます。',
      }),
    ).toBe('本人確認の完了後にご利用いただけます。');
    expect(
      callSetupFailureMessage({
        ok: false,
        error: 'partner_unavailable',
        message: '現在おかけになれません。',
      }),
    ).toBe('現在おかけになれません。');
  });

  it('規約外の本文（ゲートウェイの英語エラー等）は null（画面は汎用文言へ）', () => {
    const invalid: unknown[] = [
      { message: 'Invalid JWT' },
      { ok: true, message: 'x' },
      { ok: false, message: '' },
      { ok: false, message: '   ' },
      { ok: false, message: 123 },
      null,
      'text',
      [],
    ];
    for (const body of invalid) {
      expect(callSetupFailureMessage(body)).toBeNull();
    }
  });
});
