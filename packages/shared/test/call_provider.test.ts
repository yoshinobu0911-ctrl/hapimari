import { describe, expect, it } from 'vitest';
import { formatCallDuration, remainingCallSeconds } from '../src/call-provider';
import { CALL_MAX_DURATION_SECONDS } from '../src/constants';

describe('remainingCallSeconds（15分=900秒の自動切断境界）', () => {
  it('開始直後は900秒', () => {
    expect(remainingCallSeconds(0, 0)).toBe(CALL_MAX_DURATION_SECONDS);
    expect(CALL_MAX_DURATION_SECONDS).toBe(900);
  });

  it('899秒経過で残り1秒（まだ切断しない）', () => {
    expect(remainingCallSeconds(0, 899_000)).toBe(1);
  });

  it('900秒経過ちょうどで残り0（自動切断）', () => {
    expect(remainingCallSeconds(0, 900_000)).toBe(0);
  });

  it('900秒超過でも負値にならない', () => {
    expect(remainingCallSeconds(0, 1_000_000)).toBe(0);
  });

  it('時計逆行（now < started）でも上限を超えない', () => {
    expect(remainingCallSeconds(10_000, 0)).toBe(CALL_MAX_DURATION_SECONDS);
  });

  it('上限は引数で変更できる（Agora実装等の将来用）', () => {
    expect(remainingCallSeconds(0, 30_000, 60)).toBe(30);
  });
});

describe('formatCallDuration', () => {
  it('0:00 / 0:59 / 1:00 / 14:59 / 15:00 の表記', () => {
    expect(formatCallDuration(0)).toBe('0:00');
    expect(formatCallDuration(59)).toBe('0:59');
    expect(formatCallDuration(60)).toBe('1:00');
    expect(formatCallDuration(899)).toBe('14:59');
    expect(formatCallDuration(900)).toBe('15:00');
  });

  it('負値・小数は安全に丸める', () => {
    expect(formatCallDuration(-5)).toBe('0:00');
    expect(formatCallDuration(61.9)).toBe('1:01');
  });
});
