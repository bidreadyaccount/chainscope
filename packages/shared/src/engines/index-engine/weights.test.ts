/**
 * Weight-construction tests. The invariant that matters most for audit: bps ALWAYS
 * sum to exactly 10000. Covers every methodology, exclusions, the largest-remainder
 * rounding, and CAP_CAPPED redistribution (including infeasible caps).
 */
import { describe, expect, it } from 'vitest';
import { WEIGHT_DENOMINATOR_BPS, DEFAULT_INDEX_CONSTRAINTS } from '@chainscope/config';
import { computeWeights } from './weights.js';
import type { ConstituentInput } from './types.js';

function c(over: Partial<ConstituentInput> & { stockTokenId: string }): ConstituentInput {
  return {
    ticker: over.stockTokenId.toUpperCase(),
    sector: 'Tech',
    priceUsd: 100,
    marketCapUsd: 1_000_000_000,
    volatility: 0.3,
    ...over,
  };
}

const sum = (ws: Array<{ weightBps: number }>): number => ws.reduce((s, w) => s + w.weightBps, 0);

describe('computeWeights — sum invariant (all methodologies)', () => {
  const set = [
    c({ stockTokenId: 'a', marketCapUsd: 3_000_000_000, priceUsd: 300, volatility: 0.2 }),
    c({ stockTokenId: 'b', marketCapUsd: 1_500_000_000, priceUsd: 150, volatility: 0.35 }),
    c({ stockTokenId: 'd', marketCapUsd: 700_000_000, priceUsd: 70, volatility: 0.5 }),
  ];
  for (const m of ['EQUAL', 'MARKET_CAP', 'PRICE', 'INVERSE_VOL', 'CAP_CAPPED'] as const) {
    it(`${m}: weights sum to exactly 10000`, () => {
      const r = computeWeights(set, m);
      expect(r.ok).toBe(true);
      expect(sum(r.weights)).toBe(WEIGHT_DENOMINATOR_BPS);
      expect(r.weights.every((w) => w.weightBps >= 0)).toBe(true);
    });
  }
});

describe('computeWeights — EQUAL', () => {
  it('splits evenly and puts the rounding remainder deterministically', () => {
    // 3 names → 3333, 3333, 3334 (largest-remainder gives the last bp to order).
    const r = computeWeights(
      [c({ stockTokenId: 'a' }), c({ stockTokenId: 'b' }), c({ stockTokenId: 'd' })],
      'EQUAL',
    );
    expect(r.weights.map((w) => w.weightBps).sort((x, y) => x - y)).toEqual([3333, 3333, 3334]);
    expect(sum(r.weights)).toBe(10000);
  });
});

describe('computeWeights — MARKET_CAP', () => {
  it('is proportional to market cap', () => {
    const r = computeWeights(
      [
        c({ stockTokenId: 'a', marketCapUsd: 6_000_000_000 }),
        c({ stockTokenId: 'b', marketCapUsd: 3_000_000_000 }),
        c({ stockTokenId: 'd', marketCapUsd: 1_000_000_000 }),
      ],
      'MARKET_CAP',
    );
    const byId = new Map(r.weights.map((w) => [w.stockTokenId, w.weightBps]));
    // 6:3:1 of 10000 = 6000, 3000, 1000.
    expect(byId.get('a')).toBe(6000);
    expect(byId.get('b')).toBe(3000);
    expect(byId.get('d')).toBe(1000);
  });
});

describe('computeWeights — PRICE and INVERSE_VOL', () => {
  it('PRICE is proportional to price', () => {
    const r = computeWeights(
      [
        c({ stockTokenId: 'a', priceUsd: 200 }),
        c({ stockTokenId: 'b', priceUsd: 200 }),
        c({ stockTokenId: 'd', priceUsd: 100 }),
      ],
      'PRICE',
    );
    const byId = new Map(r.weights.map((w) => [w.stockTokenId, w.weightBps]));
    expect(byId.get('a')).toBe(4000);
    expect(byId.get('b')).toBe(4000);
    expect(byId.get('d')).toBe(2000);
  });

  it('INVERSE_VOL over-weights the lower-volatility name', () => {
    const r = computeWeights(
      [c({ stockTokenId: 'calm', volatility: 0.1 }), c({ stockTokenId: 'wild', volatility: 0.4 })],
      'INVERSE_VOL',
    );
    const byId = new Map(r.weights.map((w) => [w.stockTokenId, w.weightBps]));
    // 1/0.1 : 1/0.4 = 10 : 2.5 = 8000 : 2000.
    expect(byId.get('calm')).toBe(8000);
    expect(byId.get('wild')).toBe(2000);
  });
});

describe('computeWeights — exclusions', () => {
  it('excludes missing/non-positive inputs with a reason and reweights the rest', () => {
    const r = computeWeights(
      [
        c({ stockTokenId: 'a', marketCapUsd: 1_000_000_000 }),
        c({ stockTokenId: 'nocap', marketCapUsd: null }),
        c({ stockTokenId: 'zero', marketCapUsd: 0 }),
        c({ stockTokenId: 'b', marketCapUsd: 1_000_000_000 }),
      ],
      'MARKET_CAP',
    );
    expect(r.excluded).toEqual([
      { stockTokenId: 'nocap', ticker: 'NOCAP', reason: 'MISSING_MARKET_CAP' },
      { stockTokenId: 'zero', ticker: 'ZERO', reason: 'NON_POSITIVE' },
    ]);
    expect(sum(r.weights)).toBe(10000);
    expect(r.weights.map((w) => w.weightBps)).toEqual([5000, 5000]);
  });

  it('returns ok=false when fewer than minConstituents survive', () => {
    const r = computeWeights([c({ stockTokenId: 'a', priceUsd: null })], 'PRICE');
    expect(r.ok).toBe(false);
    expect(r.weights).toEqual([]);
    expect(r.excluded[0]?.reason).toBe('MISSING_PRICE');
  });
});

describe('computeWeights — CAP_CAPPED redistribution', () => {
  it('caps a dominant name and redistributes excess to the rest', () => {
    // Raw MCAP weights would be 80/10/10; cap at 4000 bps (40%).
    const r = computeWeights(
      [
        c({ stockTokenId: 'mega', marketCapUsd: 8_000_000_000 }),
        c({ stockTokenId: 'b', marketCapUsd: 1_000_000_000 }),
        c({ stockTokenId: 'd', marketCapUsd: 1_000_000_000 }),
      ],
      'CAP_CAPPED',
      { ...DEFAULT_INDEX_CONSTRAINTS, maxWeightBps: 4000 },
    );
    const byId = new Map(r.weights.map((w) => [w.stockTokenId, w.weightBps]));
    expect(byId.get('mega')).toBeLessThanOrEqual(4000);
    expect(sum(r.weights)).toBe(10000);
    // The two small names split the redistributed excess evenly (equal caps).
    expect(byId.get('b')).toBe(byId.get('d'));
    expect(byId.get('b')!).toBeGreaterThan(1000);
  });

  it('handles an infeasible cap (cap × N < 100%) without looping', () => {
    // 4 names, cap 2000 bps each → max 8000 < 10000. Best-effort equal split.
    const r = computeWeights(
      [
        c({ stockTokenId: 'a' }),
        c({ stockTokenId: 'b' }),
        c({ stockTokenId: 'd' }),
        c({ stockTokenId: 'e' }),
      ],
      'CAP_CAPPED',
      { ...DEFAULT_INDEX_CONSTRAINTS, maxWeightBps: 2000 },
    );
    expect(sum(r.weights)).toBe(10000);
    expect(r.weights.map((w) => w.weightBps)).toEqual([2500, 2500, 2500, 2500]);
  });

  it('MARKET_CAP honours an explicit maxWeightBps constraint too', () => {
    const r = computeWeights(
      [
        c({ stockTokenId: 'mega', marketCapUsd: 9_000_000_000 }),
        c({ stockTokenId: 'b', marketCapUsd: 1_000_000_000 }),
      ],
      'MARKET_CAP',
      { ...DEFAULT_INDEX_CONSTRAINTS, maxWeightBps: 6000 },
    );
    const byId = new Map(r.weights.map((w) => [w.stockTokenId, w.weightBps]));
    expect(byId.get('mega')).toBeLessThanOrEqual(6000);
    expect(sum(r.weights)).toBe(10000);
  });
});
