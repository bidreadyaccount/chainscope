/**
 * Tests for the shared largest-remainder apportionment used by both the index
 * simulator (cent-exact allocations, audit F-05) and the trade planner.
 */
import { describe, expect, it } from 'vitest';
import { apportion } from './math.js';

const total = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

/** Deterministic LCG for reproducible fuzz. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('apportion', () => {
  it('always sums to exactly the total', () => {
    expect(total(apportion(100, [3333, 3333, 3334], ['a', 'b', 'c']))).toBe(100);
    expect(total(apportion(100000, [6000, 4000], ['a', 'b']))).toBe(100000);
    expect(total(apportion(7, [1, 1, 1, 1, 1], ['a', 'b', 'c', 'd', 'e']))).toBe(7);
  });

  it('distributes proportionally, remainder to the largest fractional part', () => {
    expect(apportion(100, [3333, 3333, 3334], ['a', 'b', 'c'])).toEqual([33, 33, 34]);
    // exact split, no remainder
    expect(apportion(100000, [6000, 4000], ['a', 'b'])).toEqual([60000, 40000]);
  });

  it('breaks equal-remainder ties by identity, so it is order-independent', () => {
    // Three equal weights, total 100 → 34/33/33; the +1 goes to the lowest id.
    expect(apportion(100, [1, 1, 1], ['a', 'b', 'c'])).toEqual([34, 33, 33]);
    // Same buckets in a different order produce the same per-id result.
    const shuffled = apportion(100, [1, 1, 1], ['c', 'a', 'b']);
    expect(shuffled).toEqual([33, 34, 33]); // 'a' (now index 1) still gets the +1
  });

  it('returns all-zeros for degenerate inputs', () => {
    expect(apportion(0, [1, 2], ['a', 'b'])).toEqual([0, 0]);
    expect(apportion(-5, [1, 2], ['a', 'b'])).toEqual([0, 0]);
    expect(apportion(10, [], [])).toEqual([]);
    expect(apportion(10, [0, 0], ['a', 'b'])).toEqual([0, 0]);
    expect(apportion(1.5, [1, 1], ['a', 'b'])).toEqual([0, 0]); // non-integer total
  });

  it('ignores non-finite / negative weights without breaking the sum', () => {
    const out = apportion(100, [NaN, 1, -3, 1], ['a', 'b', 'c', 'd']);
    expect(total(out)).toBe(100);
    expect(out[0]).toBe(0); // NaN weight
    expect(out[2]).toBe(0); // negative weight
    expect(out[1]).toBe(50);
    expect(out[3]).toBe(50);
  });

  it('handles a total smaller than the bucket count', () => {
    // Only 2 cents to spread over 5 equal names → two names get 1, rest 0, sum 2.
    const out = apportion(2, [1, 1, 1, 1, 1], ['a', 'b', 'c', 'd', 'e']);
    expect(total(out)).toBe(2);
    expect(out.filter((x) => x === 1)).toHaveLength(2);
  });

  it('sums to the total exactly under extreme magnitudes and large N (fuzz)', () => {
    const rand = lcg(999);
    for (let k = 0; k < 500; k++) {
      const n = 1 + Math.floor(rand() * 40);
      const grand = Math.floor(rand() * 1e12); // up to ~$10B in cents
      const weights = Array.from({ length: n }, () => rand() * 1e6);
      const ids = weights.map((_, i) => `n${i}`);
      const out = apportion(grand, weights, ids);
      expect(total(out)).toBe(grand);
      expect(out.every((x) => x >= 0)).toBe(true);
    }
  });
});
