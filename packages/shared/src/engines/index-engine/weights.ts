/**
 * Weight construction (the audit-critical core). Produces integer basis-point
 * weights that sum to EXACTLY 10000 via the largest-remainder method, so an
 * index is always fully allocated with no rounding drift.
 *
 * Methodologies:
 *   EQUAL        w_i = 1/N
 *   MARKET_CAP   w_i ∝ marketCap_i
 *   PRICE        w_i ∝ price_i               (DJIA-style price weighting)
 *   INVERSE_VOL  w_i ∝ 1/volatility_i        (risk-weighted)
 *   CAP_CAPPED   MARKET_CAP, then cap each at maxWeightBps and redistribute the
 *                excess to uncapped names, iterating to convergence.
 *
 * Constituents missing the input a methodology needs (or with a non-positive
 * value) are excluded with a reason rather than silently dropped or defaulted.
 */

import {
  CAP_REDISTRIBUTION_MAX_ITERATIONS,
  DEFAULT_INDEX_CONSTRAINTS,
  WEIGHT_DENOMINATOR_BPS,
  type IndexConstraints,
  type IndexMethodology,
} from '@chainscope/config';
import type {
  ConstituentInput,
  ConstituentWeight,
  ExcludedConstituent,
  WeightResult,
} from './types.js';

/** Extract the raw weighting basis for a constituent, or an exclusion reason. */
function basisFor(
  c: ConstituentInput,
  methodology: IndexMethodology,
): { value: number } | { reason: ExcludedConstituent['reason'] } {
  switch (methodology) {
    case 'EQUAL':
      return { value: 1 };
    case 'MARKET_CAP':
    case 'CAP_CAPPED':
      if (c.marketCapUsd === null) return { reason: 'MISSING_MARKET_CAP' };
      if (c.marketCapUsd <= 0) return { reason: 'NON_POSITIVE' };
      return { value: c.marketCapUsd };
    case 'PRICE':
      if (c.priceUsd === null) return { reason: 'MISSING_PRICE' };
      if (c.priceUsd <= 0) return { reason: 'NON_POSITIVE' };
      return { value: c.priceUsd };
    case 'INVERSE_VOL':
      if (c.volatility === null) return { reason: 'MISSING_VOLATILITY' };
      if (c.volatility <= 0) return { reason: 'NON_POSITIVE' };
      return { value: 1 / c.volatility };
  }
}

/**
 * Convert real-valued fractional weights (summing to ~1) into integer bps
 * summing to EXACTLY 10000 using the largest-remainder (Hamilton) method.
 * Deterministic tie-break: larger fractional remainder first, then input order.
 */
function toBasisPoints(entries: Array<{ key: number; fraction: number }>): number[] {
  const denom = WEIGHT_DENOMINATOR_BPS;
  const scaled = entries.map((e, i) => {
    const exact = e.fraction * denom;
    const floor = Math.floor(exact);
    return { i, floor, remainder: exact - floor };
  });
  const allocated = scaled.reduce((sum, s) => sum + s.floor, 0);
  let leftover = denom - allocated;
  // Distribute the leftover bps to the largest remainders.
  const order = [...scaled].sort((a, b) =>
    b.remainder !== a.remainder ? b.remainder - a.remainder : a.i - b.i,
  );
  const bump = new Set<number>();
  for (let k = 0; k < order.length && leftover > 0; k++) {
    bump.add(order[k]!.i);
    leftover--;
  }
  return scaled.map((s) => s.floor + (bump.has(s.i) ? 1 : 0));
}

/**
 * Cap each weight at maxBps and redistribute the excess proportionally to the
 * uncapped names, iterating until stable or every name is capped. Operates on
 * fractional weights (0..1); the caller converts to bps afterward.
 */
function applyCap(fractions: number[], maxFraction: number): number[] {
  if (maxFraction >= 1) return fractions;
  let w = [...fractions];
  for (let iter = 0; iter < CAP_REDISTRIBUTION_MAX_ITERATIONS; iter++) {
    const capped = w.map((x) => x > maxFraction);
    const excess = w.reduce((s, x) => s + Math.max(0, x - maxFraction), 0);
    if (excess <= 1e-12) break;
    const uncappedSum = w.reduce((s, x, i) => (capped[i] ? s : s + x), 0);
    // If every name is at/above the cap, the cap is infeasible; distribute
    // equally among all (best effort — the caller's maxWeightBps was too tight).
    if (uncappedSum <= 1e-12) {
      return w.map(() => 1 / w.length);
    }
    w = w.map((x, i) => (capped[i] ? maxFraction : x + (excess * x) / uncappedSum));
  }
  return w;
}

/**
 * Compute basis-point weights for a set of constituents. Excludes constituents
 * lacking the methodology's required input. Returns ok=false (empty weights)
 * when fewer than `minConstituents` survive.
 */
export function computeWeights(
  constituents: readonly ConstituentInput[],
  methodology: IndexMethodology,
  constraints: IndexConstraints = DEFAULT_INDEX_CONSTRAINTS,
): WeightResult {
  const included: Array<{ c: ConstituentInput; value: number }> = [];
  const excluded: ExcludedConstituent[] = [];

  for (const c of constituents) {
    const b = basisFor(c, methodology);
    if ('reason' in b) {
      excluded.push({ stockTokenId: c.stockTokenId, ticker: c.ticker, reason: b.reason });
    } else {
      included.push({ c, value: b.value });
    }
  }

  if (included.length < constraints.minConstituents) {
    return { methodology, weights: [], excluded, ok: false };
  }

  const total = included.reduce((s, e) => s + e.value, 0);
  let fractions = included.map((e) => e.value / total);

  if (methodology === 'CAP_CAPPED' || constraints.maxWeightBps < WEIGHT_DENOMINATOR_BPS) {
    fractions = applyCap(fractions, constraints.maxWeightBps / WEIGHT_DENOMINATOR_BPS);
  }

  const bps = toBasisPoints(fractions.map((fraction, key) => ({ key, fraction })));
  const weights: ConstituentWeight[] = included.map((e, i) => ({
    stockTokenId: e.c.stockTokenId,
    ticker: e.c.ticker,
    weightBps: bps[i]!,
  }));

  return { methodology, weights, excluded, ok: true };
}
