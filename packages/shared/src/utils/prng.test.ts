import { describe, it, expect } from 'vitest';
import { mulberry32, seedFromString, DEFAULT_SEED } from './prng.js';

describe('mulberry32 PRNG', () => {
  it('is deterministic: same seed => identical sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 20 }, mulberry32(1).next);
    const b = Array.from({ length: 20 }, mulberry32(2).next);
    expect(a).not.toEqual(b);
  });

  it('emits floats in [0,1)', () => {
    const r = mulberry32(DEFAULT_SEED);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() stays within inclusive bounds', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 5_000; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('shuffle is deterministic and a permutation', () => {
    const src = Array.from({ length: 50 }, (_, i) => i);
    const s1 = mulberry32(99).shuffle(src);
    const s2 = mulberry32(99).shuffle(src);
    expect(s1).toEqual(s2);
    expect([...s1].sort((x, y) => x - y)).toEqual(src);
  });

  it('weighted() respects zero weights', () => {
    const r = mulberry32(5);
    const picks = new Set<string>();
    for (let i = 0; i < 500; i++) picks.add(r.weighted(['a', 'b', 'c'], [0, 1, 0]));
    expect([...picks]).toEqual(['b']);
  });

  it('seedFromString is stable and 32-bit', () => {
    expect(seedFromString('hello')).toBe(seedFromString('hello'));
    expect(seedFromString('hello')).not.toBe(seedFromString('world'));
    expect(seedFromString('x')).toBeGreaterThanOrEqual(0);
    expect(seedFromString('x')).toBeLessThanOrEqual(0xffffffff);
  });
});
