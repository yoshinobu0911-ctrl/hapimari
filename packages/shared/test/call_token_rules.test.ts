import { describe, expect, it } from 'vitest';
import { interpretBlockCheck } from '../../../supabase/functions/_shared/call_token_rules';

describe('interpretBlockCheck（I28: 判定できないときは発行しない）', () => {
  it('error あり・data null → unavailable', () => {
    const r = interpretBlockCheck({ data: null, error: { message: 'x' } });
    expect(r).toBe('unavailable');
  });
  it('error なし・data null → unavailable', () => {
    expect(interpretBlockCheck({ data: null, error: null })).toBe('unavailable');
  });
  it('true → blocked', () => {
    expect(interpretBlockCheck({ data: true, error: null })).toBe('blocked');
  });
  it('false → clear（発行へ進めるのはこれだけ）', () => {
    expect(interpretBlockCheck({ data: false, error: null })).toBe('clear');
  });
  it('error ありなら data=false でも unavailable', () => {
    const r = interpretBlockCheck({ data: false, error: { code: '' } });
    expect(r).toBe('unavailable');
  });
  it.each([['false'], [0], [undefined], [{}], [[false]]])('boolean 以外 %p → unavailable', (v) => {
    expect(interpretBlockCheck({ data: v, error: null })).toBe('unavailable');
  });
});
