/**
 * Tests for the custom index builder (buildManualWeights) and the portfolio
 * simulator (simulateInvestment) — the new interactive primitives. Same 10000
 * invariant and cap semantics as computeWeights; simulator allocation and
 * historical value are hand-checked.
 */
import { describe, expect, it } from 'vitest';
import { buildManualWeights } from './weights.js';
import { simulateInvestment } from './valuation.js';
import type { ConstituentWeight, PerformancePoint } from './types.js';

const sum = (ws: Array<{ weightBps: number }>): number => ws.reduce((s, w) => s + w.weightBps, 0);
const m = (id: string, weight: number) => ({ stockTokenId: id, ticker: id.toUpperCase(), weight });

/** Deterministic LCG so the randomized reconciliation fuzz is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('buildManualWeights', () => {
  it('normalizes arbitrary positive weights to exactly 10000 bps', () => {
    const r = buildManualWeights([m('a', 3), m('b', 1)]);
    expect(r.ok).toBe(true);
    expect(sum(r.weights)).toBe(10000);
    const byId = new Map(r.weights.map((w) => [w.stockTokenId, w.weightBps]));
    expect(byId.get('a')).toBe(7500);
    expect(byId.get('b')).toBe(2500);
  });

  it('percentage-style inputs (60/40) map straight through', () => {
    const r = buildManualWeights([m('a', 60), m('b', 40)]);
    expect(r.weights.map((w) => w.weightBps)).toEqual([6000, 4000]);
  });

  it('excludes non-finite / non-positive entries with reasons', () => {
    const r = buildManualWeights([m('a', 50), m('bad', NaN), m('neg', -5), m('b', 50)]);
    expect(r.excluded.map((e) => e.reason).sort()).toEqual(['NON_FINITE', 'NON_POSITIVE']);
    expect(sum(r.weights)).toBe(10000);
  });

  it('respects a cap and reports an infeasible one', () => {
    const capped = buildManualWeights([m('a', 90), m('b', 5), m('d', 5)], {
      maxWeightBps: 5000,
      minConstituents: 2,
    });
    expect(capped.ok).toBe(true);
    expect(capped.weights.every((w) => w.weightBps <= 5000)).toBe(true);
    expect(sum(capped.weights)).toBe(10000);

    const infeasible = buildManualWeights([m('a', 1), m('b', 1), m('d', 1)], {
      maxWeightBps: 3000,
      minConstituents: 2,
    });
    expect(infeasible.ok).toBe(false);
    expect(infeasible.error).toBe('CAP_INFEASIBLE');
  });

  it('fewer than the minimum valid entries → ok:false', () => {
    expect(buildManualWeights([m('a', 1)]).ok).toBe(false);
  });

  it('aggregates duplicate identities instead of double-counting (audit R-03)', () => {
    // Same stock entered twice (60 + 40) is ONE exposure, not two names.
    const r = buildManualWeights([m('a', 60), m('a', 40), m('b', 100)]);
    expect(r.ok).toBe(true);
    expect(r.weights).toHaveLength(2); // 'a' collapsed to one
    const byId = new Map(r.weights.map((w) => [w.stockTokenId, w.weightBps]));
    expect(byId.get('a')).toBe(5000); // (60+40) vs 100 → 50/50
    expect(byId.get('b')).toBe(5000);
    expect(sum(r.weights)).toBe(10000);
  });

  it('a lone stock duplicated collapses below the minimum → ok:false', () => {
    // [AAPL 60, AAPL 40] is one unique name, not an index.
    expect(buildManualWeights([m('a', 60), m('a', 40)]).ok).toBe(false);
  });
});

describe('simulateInvestment', () => {
  const W = (id: string, bps: number): ConstituentWeight => ({
    stockTokenId: id,
    ticker: id.toUpperCase(),
    weightBps: bps,
  });

  it('splits an investment into per-constituent allocation and shares', () => {
    const sim = simulateInvestment(
      1000,
      [W('a', 6000), W('b', 4000)],
      new Map([
        ['a', 300],
        ['b', 100],
      ]),
    );
    const byId = new Map(sim.allocations.map((a) => [a.stockTokenId, a]));
    expect(byId.get('a')!.allocationUsd).toBe(600);
    expect(byId.get('a')!.shares).toBeCloseTo(2, 6); // $600 / $300
    expect(byId.get('b')!.allocationUsd).toBe(400);
    expect(byId.get('b')!.shares).toBeCloseTo(4, 6);
    expect(sim.investedWeightBps).toBe(10000);
  });

  it('projects historical value from an index level series (amount · level/level0)', () => {
    const day = 86_400_000;
    const t0 = Date.UTC(2026, 0, 1);
    const series: PerformancePoint[] = [
      { takenAt: t0, level: 1000 },
      { takenAt: t0 + day, level: 1100 },
      { takenAt: t0 + 2 * day, level: 1210 },
    ];
    const sim = simulateInvestment(500, [W('a', 10000)], new Map([['a', 50]]), series);
    // 500 · 1210/1000 = 605; total return = +21%.
    expect(sim.projectionAvailable).toBe(true);
    expect(sim.finalValueUsd).toBe(605);
    expect(sim.totalReturn).toBeCloseTo(0.21, 6);
    expect(sim.valueSeries).toHaveLength(3);
    expect(sim.valueSeries[1]!.valueUsd).toBe(550);
  });

  it('surfaces an unpriced constituent AND suppresses the mismatched projection (audit R-02)', () => {
    const day = 86_400_000;
    const t0 = Date.UTC(2026, 0, 1);
    const series: PerformancePoint[] = [
      { takenAt: t0, level: 1000 },
      { takenAt: t0 + day, level: 500 }, // index history (full basket)
    ];
    const sim = simulateInvestment(
      1000,
      [W('a', 5000), W('b', 5000)],
      new Map<string, number | null>([
        ['a', 100],
        ['b', null],
      ]),
      series,
    );
    expect(sim.excluded[0]?.ticker).toBe('B');
    expect(sim.investedWeightBps).toBe(5000);
    // A absorbs the full $1000 (renormalized), 10 shares; realized weight = 100%.
    expect(sim.allocations[0]!.allocationUsd).toBe(1000);
    expect(sim.allocations[0]!.shares).toBeCloseTo(10, 6);
    expect(sim.allocations[0]!.realizedWeightBps).toBe(10000);
    // The constructed basket is NOT the index, so no projection is reported
    // (rather than applying the full-index −50% path to an A-only portfolio).
    expect(sim.projectionAvailable).toBe(false);
    expect(sim.projectionUnavailableReason).toBeTruthy();
    expect(sim.valueSeries).toEqual([]);
    expect(sim.finalValueUsd).toBeNull();
  });

  it('non-positive amount yields zero allocation and null projection', () => {
    const sim = simulateInvestment(0, [W('a', 10000)], new Map([['a', 100]]));
    expect(sim.amountUsd).toBe(0);
    expect(sim.allocations.every((a) => a.allocationUsd === 0 && a.shares === 0)).toBe(true);
    expect(sim.finalValueUsd).toBeNull();
    expect(sim.totalReturn).toBeNull();
  });

  it('realized weights reconcile to exactly 10000 after exclusion (audit F-01)', () => {
    // 4 names at 2500 each; one unpriced → 3 priced names split 1/3 each. Independent
    // Math.round would give [3333,3333,3333]=9999; largest-remainder must sum to 10000.
    const sim = simulateInvestment(
      3000,
      [W('a', 2500), W('b', 2500), W('d', 2500), W('e', 2500)],
      new Map<string, number | null>([
        ['a', 100],
        ['b', 100],
        ['d', 100],
        ['e', null], // unpriced
      ]),
    );
    const realizedSum = sim.allocations.reduce((s, x) => s + x.realizedWeightBps, 0);
    expect(realizedSum).toBe(10000);
    expect(sim.allocations.map((a) => a.realizedWeightBps).sort((x, y) => x - y)).toEqual([
      3333, 3333, 3334,
    ]);
  });

  it('allocations sum EXACTLY to the investment — no cent drift (audit F-05)', () => {
    // The audit's repro: $1.00 across [3333, 3333, 3334] at $1 each rounds to $0.99
    // under independent per-name rounding. Cent apportionment must total $1.00.
    const sim = simulateInvestment(
      1,
      [W('a', 3333), W('b', 3333), W('d', 3334)],
      new Map([
        ['a', 1],
        ['b', 1],
        ['d', 1],
      ]),
    );
    const cents = sim.allocations.reduce((s, a) => s + Math.round(a.allocationUsd * 100), 0);
    expect(cents).toBe(100);
  });

  it('shares never contradict the dollar allocation, even at extreme price (audit F-06)', () => {
    // $1 into a name priced $10M rounded shares to 0 while showing $1 allocated.
    const sim = simulateInvestment(1, [W('a', 10000)], new Map([['a', 10_000_000]]));
    const a = sim.allocations[0]!;
    expect(a.allocationUsd).toBe(1); // dollars are authoritative
    expect(a.shares).toBeGreaterThan(0); // not rounded away to zero
    expect(Math.abs(a.shares * a.priceUsd - a.allocationUsd)).toBeLessThan(1e-6);
  });

  it('reconciles to the cent and keeps shares consistent across random books (F-05/F-06)', () => {
    const rand = lcg(20260718);
    for (let t = 0; t < 400; t++) {
      const n = 2 + Math.floor(rand() * 6); // 2..7 names
      const cents = 1 + Math.floor(rand() * 1_000_000); // $0.01 .. $10,000.00
      const amount = cents / 100;
      const weights: ConstituentWeight[] = [];
      const prices = new Map<string, number>();
      for (let i = 0; i < n; i++) {
        const id = `s${i}`;
        weights.push(W(id, 1 + Math.floor(rand() * 9999)));
        prices.set(id, Math.round((0.01 + rand() * 5000) * 100) / 100); // positive price
      }
      const sim = simulateInvestment(amount, weights, prices);
      const allocated = sim.allocations.reduce((s, a) => s + Math.round(a.allocationUsd * 100), 0);
      expect(allocated).toBe(cents); // exact cent conservation
      for (const a of sim.allocations) {
        expect(Math.abs(a.shares * a.priceUsd - a.allocationUsd)).toBeLessThan(1e-6);
      }
    }
  });

  it('reconciles to the cent even when some names are unpriced (audit F-05 partial)', () => {
    const rand = lcg(77);
    let checked = 0;
    for (let n0 = 0; n0 < 300; n0++) {
      const n = 2 + Math.floor(rand() * 6);
      const cents = 1 + Math.floor(rand() * 1_000_000);
      const amount = cents / 100;
      const weights: ConstituentWeight[] = [];
      const prices = new Map<string, number | null>();
      let priced = 0;
      for (let i = 0; i < n; i++) {
        const id = `s${i}`;
        weights.push(W(id, 1 + Math.floor(rand() * 9999)));
        if (rand() < 0.3) {
          prices.set(id, null); // unpriced → excluded, weight renormalized across the rest
        } else {
          prices.set(id, Math.round((0.01 + rand() * 5000) * 100) / 100);
          priced++;
        }
      }
      if (priced === 0) continue; // nothing to build
      checked++;
      const sim = simulateInvestment(amount, weights, prices);
      const allocated = sim.allocations.reduce((s, a) => s + Math.round(a.allocationUsd * 100), 0);
      expect(allocated).toBe(cents); // full amount deployed across the priced names, exact
    }
    expect(checked).toBeGreaterThan(50);
  });
});
