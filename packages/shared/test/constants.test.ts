import { describe, expect, it } from 'vitest';
import { calcAge, canRegister } from '../src/constants';

const NOW = new Date('2026-07-05T00:00:00+09:00');

describe('calcAge', () => {
  it('誕生日前は1歳引く', () => {
    expect(calcAge('1991-12-31', NOW)).toBe(34);
    expect(calcAge('1991-07-01', NOW)).toBe(35);
  });
});

describe('canRegister（R1: 女性35歳以上・男性45歳以上）', () => {
  it('34歳女性は登録不可（M1受け入れ条件）', () => {
    expect(canRegister('female', '1991-12-01', NOW)).toBe(false);
  });

  it('35歳女性は登録可', () => {
    expect(canRegister('female', '1991-07-01', NOW)).toBe(true);
  });

  it('44歳男性は登録不可（M1受け入れ条件）', () => {
    expect(canRegister('male', '1981-12-01', NOW)).toBe(false);
  });

  it('45歳男性は登録可', () => {
    expect(canRegister('male', '1981-07-01', NOW)).toBe(true);
  });

  it('上限なし: 80歳でも登録可', () => {
    expect(canRegister('male', '1946-01-01', NOW)).toBe(true);
    expect(canRegister('female', '1946-01-01', NOW)).toBe(true);
  });
});
