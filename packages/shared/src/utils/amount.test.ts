import { describe, it, expect } from 'vitest';
import { toRawAmount, fromRawAmount } from './amount.js';

describe('decimal amount conversion', () => {
  it('scales by decimals (18)', () => {
    expect(toRawAmount(1, 18)).toBe('1000000000000000000');
    expect(toRawAmount(1.5, 18)).toBe('1500000000000000000');
  });

  it('handles 6 and 8 decimals', () => {
    expect(toRawAmount(1, 6)).toBe('1000000');
    expect(toRawAmount(2.5, 6)).toBe('2500000');
    expect(toRawAmount(1, 8)).toBe('100000000');
  });

  it('handles 0 decimals', () => {
    expect(toRawAmount(42, 0)).toBe('42');
  });

  it('produces integer strings (never floats) and clamps negatives', () => {
    expect(toRawAmount(0.000001, 6)).toBe('1');
    expect(/^\d+$/.test(toRawAmount(123.456789, 18))).toBe(true);
    expect(toRawAmount(-5, 18)).toBe('0');
    expect(toRawAmount(0, 18)).toBe('0');
  });

  it('round-trips approximately for representable values', () => {
    expect(fromRawAmount('1000000000000000000', 18)).toBe(1);
    expect(fromRawAmount('2500000', 6)).toBe(2.5);
    expect(fromRawAmount('42', 0)).toBe(42);
  });
});
