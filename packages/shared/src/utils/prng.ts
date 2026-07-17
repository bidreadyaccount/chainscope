/**
 * Deterministic pseudo-random number generation.
 *
 * mulberry32 — a tiny, fast, well-distributed 32-bit PRNG. Same seed always
 * yields the same sequence, which is the backbone of the deterministic demo
 * data generator (BUILD_BRIEF §7).
 */

export const DEFAULT_SEED = 1337;

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability p (0..1). */
  bool(p?: number): boolean;
  /** Uniformly pick an element. */
  pick<T>(items: readonly T[]): T;
  /** In-place-safe shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** Weighted pick; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
}

/** Create a mulberry32 generator seeded by `seed`. */
export function mulberry32(seed: number = DEFAULT_SEED): Rng {
  // Coerce to uint32 so callers can pass arbitrary integers.
  let a = seed >>> 0;

  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int(min: number, max: number): number {
      if (max < min) [min, max] = [max, min];
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min: number, max: number): number {
      return min + next() * (max - min);
    },
    bool(p = 0.5): boolean {
      return next() < p;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() called on empty array');
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    weighted<T>(items: readonly T[], weights: readonly number[]): T {
      if (items.length === 0 || items.length !== weights.length) {
        throw new Error('weighted() requires items and weights of equal, non-zero length');
      }
      const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i]!);
        if (r <= 0) return items[i]!;
      }
      return items[items.length - 1]!;
    },
  };

  return rng;
}

/**
 * Deterministic string → 32-bit seed (FNV-1a). Lets scenarios derive stable
 * sub-seeds from names without a central counter.
 */
export function seedFromString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
