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
});
