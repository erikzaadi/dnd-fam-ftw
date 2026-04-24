import { describe, it, expect } from 'vitest';
import { getHpColors } from './hpColors';

describe('getHpColors', () => {
  it('returns rose for HP at or below 25%', () => {
    expect(getHpColors(2, 8)).toEqual({ bar: 'bg-rose-500', text: 'text-rose-400' });
    expect(getHpColors(0, 8)).toEqual({ bar: 'bg-rose-500', text: 'text-rose-400' });
  });

  it('returns amber for HP between 26% and 50%', () => {
    expect(getHpColors(3, 8)).toEqual({ bar: 'bg-amber-500', text: 'text-amber-400' });
    expect(getHpColors(4, 8)).toEqual({ bar: 'bg-amber-500', text: 'text-amber-400' });
  });

  it('returns emerald for HP above 50%', () => {
    expect(getHpColors(5, 8)).toEqual({ bar: 'bg-emerald-500', text: 'text-emerald-400' });
    expect(getHpColors(8, 8)).toEqual({ bar: 'bg-emerald-500', text: 'text-emerald-400' });
  });

  it('treats zero maxHp as 0% (rose)', () => {
    expect(getHpColors(0, 0)).toEqual({ bar: 'bg-rose-500', text: 'text-rose-400' });
  });
});
