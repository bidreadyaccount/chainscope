/**
 * Valuation tests: basket/level, NAV continuity across a rebalance, performance
 * (windowed returns, annualized vol, max drawdown), sector allocation,
 * concentration (HHI / effective N), and turnover — all against hand-computed
 * fixtures.
 */
import { describe, expect, it } from 'vitest';
import {
  buildBasket,
  computeLevel,
  computeSectorAllocation,
  computeConcentration,
  computeTurnoverBps,
  computePerformance,
} from './valuation.js';
import type { ConstituentInput, ConstituentWeight, PerformancePoint } from './types.js';

const W = (stockTokenId: string, weightBps: number): ConstituentWeight => ({
  stockTokenId,
  ticker: stockTokenId.toUpperCase(),
  weightBps,
});

describe('buildBasket + computeLevel', () => {
  it('starts at baseValue and shares realize the target weights', () => {
    const weights = [W('a', 6000), W('b', 4000)];
    const prices = new Map<string, number | null>([
      ['a', 300],
      ['b', 100],
    ]);
    const basket = buildBasket(weights, prices, 1000);
    expect(basket.level).toBe(1000);
    expect(basket.navUsd).toBe(1000);
    // a: 60% of $1000 = $600 / $300 = 2 shares; b: $400 / $100 = 4 shares.
    const byId = new Map(basket.holdings.map((h) => [h.stockTokenId, h.shares]));
    expect(byId.get('a')).toBeCloseTo(2, 10);
    expect(byId.get('b')).toBeCloseTo(4, 10);
  });

  it('level moves with prices (buy-and-hold drift between rebalances)', () => {
    const basket = buildBasket(
      [W('a', 5000), W('b', 5000)],
      new Map([
        ['a', 100],
        ['b', 100],
      ]),
      1000,
    );
    // a +20%, b −10% → basket 500·1.2 + 500·0.9 = 600 + 450 = 1050.
    const lvl = computeLevel(
      basket,
      new Map([
        ['a', 120],
        ['b', 90],
      ]),
    );
    expect(lvl.navUsd).toBe(1050);
    expect(lvl.level).toBe(1050);
  });
});

describe('rebalance NAV/level continuity', () => {
  it('reallocating to new weights preserves level at the rebalance instant', () => {
    const p0 = new Map<string, number | null>([
      ['a', 100],
      ['b', 100],
    ]);
    const start = buildBasket([W('a', 5000), W('b', 5000)], p0, 1000);
    // Prices drift to a=150, b=50 → NAV = 5·150 + 5·50 = 750 + 250 = 1000.
    const pReb = new Map<string, number | null>([
      ['a', 150],
      ['b', 50],
    ]);
    const preLevel = computeLevel(start, pReb).level;
    // Rebalance to 70/30 at current prices, reusing the SAME NAV as baseValue.
    const rebalanced = buildBasket([W('a', 7000), W('b', 3000)], pReb, preLevel);
    const postLevel = computeLevel(rebalanced, pReb).level;
    expect(postLevel).toBeCloseTo(preLevel, 6); // continuous
    // New shares realize 70/30 at the rebalance prices.
    const byId = new Map(rebalanced.holdings.map((h) => [h.stockTokenId, h.shares]));
    expect(byId.get('a')! * 150).toBeCloseTo(0.7 * preLevel, 4);
  });
});

describe('computeSectorAllocation', () => {
  it('sums weights by sector, sorted desc', () => {
    const constituents: ConstituentInput[] = [
      {
        stockTokenId: 'a',
        ticker: 'A',
        sector: 'Tech',
        priceUsd: 1,
        marketCapUsd: 1,
        volatility: 0.2,
      },
      {
        stockTokenId: 'b',
        ticker: 'B',
        sector: 'Tech',
        priceUsd: 1,
        marketCapUsd: 1,
        volatility: 0.2,
      },
      {
        stockTokenId: 'd',
        ticker: 'D',
        sector: 'Energy',
        priceUsd: 1,
        marketCapUsd: 1,
        volatility: 0.2,
      },
    ];
    const alloc = computeSectorAllocation([W('a', 4000), W('b', 3000), W('d', 3000)], constituents);
    expect(alloc).toEqual([
      { sector: 'Tech', weightBps: 7000 },
      { sector: 'Energy', weightBps: 3000 },
    ]);
  });
});

describe('computeConcentration', () => {
  it('equal-weighted N names → HHI = 1/N, effectiveN = N', () => {
    const eq = [W('a', 2500), W('b', 2500), W('d', 2500), W('e', 2500)];
    const r = computeConcentration(eq);
    expect(r.hhi).toBeCloseTo(0.25, 6);
    expect(r.effectiveN).toBeCloseTo(4, 2);
    expect(r.top1Bps).toBe(2500);
    expect(r.top5Bps).toBe(10000);
  });

  it('a concentrated book has higher HHI and lower effective N', () => {
    const conc = computeConcentration([W('a', 9000), W('b', 1000)]);
    // 0.9^2 + 0.1^2 = 0.82.
    expect(conc.hhi).toBeCloseTo(0.82, 6);
    expect(conc.effectiveN).toBeCloseTo(1.2195, 3);
    expect(conc.top1Bps).toBe(9000);
  });
});

describe('computeTurnoverBps', () => {
  it('half the summed absolute weight change', () => {
    // a 6000→4000 (−2000), b 4000→6000 (+2000). Σ|Δ| = 4000, turnover = 2000.
    const t = computeTurnoverBps([W('a', 6000), W('b', 4000)], [W('a', 4000), W('b', 6000)]);
    expect(t).toBe(2000);
  });

  it('a name entering/leaving counts its full weight', () => {
    // old: a 10000; new: a 5000, b 5000. Σ|Δ| = 5000 + 5000 = 10000 → 5000.
    const t = computeTurnoverBps([W('a', 10000)], [W('a', 5000), W('b', 5000)]);
    expect(t).toBe(5000);
  });

  it('identical weights → zero turnover', () => {
    expect(computeTurnoverBps([W('a', 10000)], [W('a', 10000)])).toBe(0);
  });
});

describe('computePerformance', () => {
  const day = 86_400_000;
  const t0 = Date.UTC(2026, 0, 1);
  const series = (levels: number[]): PerformancePoint[] =>
    levels.map((level, i) => ({ takenAt: t0 + i * day, level }));

  it('computes windowed returns from the correct reference points', () => {
    // 8 daily points: 100 → 110 (latest). 1d ref = day6 (105) → 110/105-1.
    const pts = series([100, 101, 102, 103, 104, 105, 108, 110]);
    const perf = computePerformance(pts);
    expect(perf.latestLevel).toBe(110);
    expect(perf.firstLevel).toBe(100);
    expect(perf.returns['1d']).toBeCloseTo(110 / 108 - 1, 6);
    expect(perf.returns['7d']).toBeCloseTo(110 / 100 - 1, 6);
  });

  it('max drawdown captures the worst peak-to-trough', () => {
    // Peak 120, trough 90 → −25%.
    const perf = computePerformance(series([100, 120, 90, 100]));
    expect(perf.maxDrawdown).toBeCloseTo(90 / 120 - 1, 6);
  });

  it('annualized volatility is stdev(returns)·√252', () => {
    // Alternating ±10% returns from 100: 100,110,99,108.9,...
    const perf = computePerformance(series([100, 110, 99, 108.9]));
    expect(perf.annualizedVolatility).not.toBeNull();
    expect(perf.annualizedVolatility!).toBeGreaterThan(1); // very volatile → >100% annualized
  });

  it('returns nulls for an empty or single-point series', () => {
    expect(computePerformance([]).maxDrawdown).toBeNull();
    expect(computePerformance(series([100])).annualizedVolatility).toBeNull();
    expect(computePerformance(series([100])).returns['7d']).toBeNull();
  });
});
