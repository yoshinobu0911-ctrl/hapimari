import { describe, expect, it } from 'vitest';
import { calcAge, canRegister } from '../src/constants';

const NOW = new Date('2026-07-05T00:00:00+09:00');

describe('calcAge', () => {
  it('誕生日前は1歳引く', () => {
    expect(calcAge('1991-12-31', NOW)).toBe(34);
    expect(calcAge('1991-07-01', NOW)).toBe(35);
  });
});

describe('canRegister（R1: 男女とも35歳以上・2026-07-12改定）', () => {
  it('34歳は男女とも登録不可', () => {
    expect(canRegister('female', '1991-12-01', NOW)).toBe(false);
    expect(canRegister('male', '1991-12-01', NOW)).toBe(false);
  });

  it('35歳は男女とも登録可', () => {
    expect(canRegister('female', '1991-07-01', NOW)).toBe(true);
    expect(canRegister('male', '1991-07-01', NOW)).toBe(true);
  });

  it('44歳男性も登録可（旧仕様の45歳制限は撤廃済み）', () => {
    expect(canRegister('male', '1981-12-01', NOW)).toBe(true);
  });

  it('上限なし: 80歳でも登録可', () => {
    expect(canRegister('male', '1946-01-01', NOW)).toBe(true);
    expect(canRegister('female', '1946-01-01', NOW)).toBe(true);
  });
});
