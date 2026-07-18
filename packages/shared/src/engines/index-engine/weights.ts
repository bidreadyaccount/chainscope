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
 *   CAP_CAPPED   MARKET_CAP, then cap each at maxWeightBps by finite water-filling
 *                (redistribute capped excess to below-cap names), guaranteeing
 *                every returned weight ≤ cap.
 *
 * Robustness (hardened after audit W-01/W-02/W-03):
 *   - Non-finite (NaN/±Infinity) and non-positive inputs are excluded with a
 *     reason; they never enter normalization.
 *   - Cap redistribution is a finite active-set algorithm (≤ N passes) and the
 *     result is asserted ≤ cap after integer rounding; an infeasible cap
 *     (cap × N < 10000) returns ok:false with error 'CAP_INFEASIBLE' rather than
 *     a silently over-cap book.
 *   - The largest-remainder tie-break is keyed on constituent identity, so the
 *     output is independent of input ordering.
 *   - Post-conditions (finite fractions, exact 10000 sum, cap compliance) are
 *     validated before returning ok:true.
 */

import {
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

/** A positive, finite basis value, or an exclusion reason. */
function basisFor(
  c: ConstituentInput,
  methodology: IndexMethodology,
): { value: number } | { reason: ExcludedConstituent['reason'] } {
  const finitePositive = (
    v: number | null,
    missing: ExcludedConstituent['reason'],
    transform: (x: number) => number = (x) => x,
  ): { value: number } | { reason: ExcludedConstituent['reason'] } => {
    if (v === null) return { reason: missing };
    if (!Number.isFinite(v)) return { reason: 'NON_FINITE' };
    if (v <= 0) return { reason: 'NON_POSITIVE' };
    const out = transform(v);
    if (!Number.isFinite(out) || out <= 0) return { reason: 'NON_FINITE' };
    return { value: out };
  };

  switch (methodology) {
    case 'EQUAL':
      return { value: 1 };
    case 'MARKET_CAP':
    case 'CAP_CAPPED':
      return finitePositive(c.marketCapUsd, 'MISSING_MARKET_CAP');
    case 'PRICE':
      return finitePositive(c.priceUsd, 'MISSING_PRICE');
    case 'INVERSE_VOL':
      return finitePositive(c.volatility, 'MISSING_VOLATILITY', (v) => 1 / v);
  }
}

interface BpsEntry {
  id: string;
  fraction: number;
}

/**
 * Convert fractional weights (summing to ~1) to integer bps summing to EXACTLY
 * 10000 via largest-remainder (Hamilton). Tie-break: larger remainder first,
 * then stable constituent identity (order-independent). When `capBps` is given,
 * the +1 remainder bumps skip names already at the cap, so no rounding pushes a
 * weight over its cap.
 */
function toBasisPoints(entries: BpsEntry[], capBps = WEIGHT_DENOMINATOR_BPS): number[] {
  const denom = WEIGHT_DENOMINATOR_BPS;
  const scaled = entries.map((e, i) => {
    const exact = e.fraction * denom;
    const floor = Math.floor(exact);
    return { i, id: e.id, floor: Math.min(floor, capBps), remainder: exact - Math.floor(exact) };
  });
  const allocated = scaled.reduce((sum, s) => sum + s.floor, 0);
  let leftover = denom - allocated;
  // Largest remainder first; ties broken by identity for order-independence.
  const order = [...scaled].sort((a, b) =>
    b.remainder !== a.remainder
      ? b.remainder - a.remainder
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  );
  const result = scaled.map((s) => s.floor);
  // Distribute leftover, one bp at a time, to below-cap names in remainder order,
  // looping until placed (feasible because the caller guarantees cap × N ≥ 10000).
  let guard = 0;
  while (leftover > 0 && guard < denom * 2) {
    let placedThisPass = false;
    for (const s of order) {
      if (leftover === 0) break;
      if (result[s.i]! < capBps) {
        result[s.i]! += 1;
        leftover--;
        placedThisPass = true;
      }
    }
    if (!placedThisPass) break; // every name at cap (should not happen when feasible)
    guard++;
  }
  return result;
}

/**
 * Finite water-filling: return fractions summing to 1 with every fraction ≤
 * maxFraction. Each pass freezes the names that would exceed the cap at exactly
 * the cap and redistributes the remaining budget to the still-free names in
 * proportion to their basis value. Terminates in ≤ N passes (each pass freezes
 * ≥ 1 name or finishes). Assumes the cap is feasible (maxFraction × N ≥ 1).
 */
function waterFill(values: number[], maxFraction: number): number[] {
  const n = values.length;
  const frac = new Array<number>(n).fill(0);
  const frozen = new Array<boolean>(n).fill(false);
  let budget = 1;
  for (let pass = 0; pass < n; pass++) {
    let freeSum = 0;
    for (let i = 0; i < n; i++) if (!frozen[i]) freeSum += values[i]!;
    if (freeSum <= 0) break;
    let froze = false;
    for (let i = 0; i < n; i++) {
      if (frozen[i]) continue;
      const tentative = (budget * values[i]!) / freeSum;
      if (tentative > maxFraction + 1e-15) {
        frozen[i] = true;
        frac[i] = maxFraction;
        froze = true;
      }
    }
    if (!froze) {
      // No free name exceeds the cap: assign the proportional split and finish.
      for (let i = 0; i < n; i++) if (!frozen[i]) frac[i] = (budget * values[i]!) / freeSum;
      return frac;
    }
    budget = 1;
    for (let i = 0; i < n; i++) if (frozen[i]) budget -= frac[i]!;
  }
  return frac;
}

/**
 * Compute basis-point weights. Excludes constituents lacking a finite positive
 * input for the methodology. Returns ok:false (with `error` when relevant) if
 * fewer than `minConstituents` survive or the cap is infeasible.
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

  const capped = methodology === 'CAP_CAPPED' || constraints.maxWeightBps < WEIGHT_DENOMINATOR_BPS;
  const maxBps = capped ? constraints.maxWeightBps : WEIGHT_DENOMINATOR_BPS;

  // Infeasible cap: cannot reach 100% with every name ≤ cap — report, don't fudge.
  if (capped && maxBps * included.length < WEIGHT_DENOMINATOR_BPS) {
    return { methodology, weights: [], excluded, ok: false, error: 'CAP_INFEASIBLE' };
  }

  const total = included.reduce((s, e) => s + e.value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return { methodology, weights: [], excluded, ok: false, error: 'INVALID_INPUT' };
  }

  const values = included.map((e) => e.value);
  let fractions = values.map((v) => v / total);
  if (capped) fractions = waterFill(values, maxBps / WEIGHT_DENOMINATOR_BPS);
  if (!fractions.every((f) => Number.isFinite(f) && f >= 0)) {
    return { methodology, weights: [], excluded, ok: false, error: 'INVALID_INPUT' };
  }

  const bps = toBasisPoints(
    included.map((e, i) => ({
      id: e.c.stockTokenId || e.c.ticker || String(i),
      fraction: fractions[i]!,
    })),
    maxBps,
  );

  // Post-conditions: exact sum and cap compliance. Fail loudly rather than emit
  // a book that violates the advertised invariant.
  const sum = bps.reduce((s, b) => s + b, 0);
  if (sum !== WEIGHT_DENOMINATOR_BPS || bps.some((b) => b > maxBps || b < 0)) {
    return { methodology, weights: [], excluded, ok: false, error: 'INVARIANT_FAILED' };
  }

  const weights: ConstituentWeight[] = included.map((e, i) => ({
    stockTokenId: e.c.stockTokenId,
    ticker: e.c.ticker,
    weightBps: bps[i]!,
  }));
  return { methodology, weights, excluded, ok: true };
}

/** One raw user-supplied weight for the custom index builder. */
export interface ManualWeightInput {
  readonly stockTokenId: string;
  readonly ticker: string;
  /** Any positive finite number; the set is normalized to 10000 bps. */
  readonly weight: number;
}

/**
 * Build basis-point weights from arbitrary user-supplied positive weights
 * (the custom index builder). Non-finite/non-positive entries are excluded with
 * a reason; the remainder is normalized to EXACTLY 10000 bps with the same
 * largest-remainder + optional cap machinery as `computeWeights`. Same
 * post-conditions and CAP_INFEASIBLE semantics.
 */
export function buildManualWeights(
  entries: readonly ManualWeightInput[],
  constraints: IndexConstraints = DEFAULT_INDEX_CONSTRAINTS,
): WeightResult {
  const included: ManualWeightInput[] = [];
  const excluded: ExcludedConstituent[] = [];
  for (const e of entries) {
    if (!Number.isFinite(e.weight)) {
      excluded.push({ stockTokenId: e.stockTokenId, ticker: e.ticker, reason: 'NON_FINITE' });
    } else if (e.weight <= 0) {
      excluded.push({ stockTokenId: e.stockTokenId, ticker: e.ticker, reason: 'NON_POSITIVE' });
    } else {
      included.push(e);
    }
  }

  if (included.length < constraints.minConstituents) {
    return { methodology: 'MANUAL', weights: [], excluded, ok: false };
  }

  const capped = constraints.maxWeightBps < WEIGHT_DENOMINATOR_BPS;
  const maxBps = capped ? constraints.maxWeightBps : WEIGHT_DENOMINATOR_BPS;
  if (capped && maxBps * included.length < WEIGHT_DENOMINATOR_BPS) {
    return { methodology: 'MANUAL', weights: [], excluded, ok: false, error: 'CAP_INFEASIBLE' };
  }

  const values = included.map((e) => e.weight);
  const total = values.reduce((s, v) => s + v, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return { methodology: 'MANUAL', weights: [], excluded, ok: false, error: 'INVALID_INPUT' };
  }
  const fractions = capped
    ? waterFill(values, maxBps / WEIGHT_DENOMINATOR_BPS)
    : values.map((v) => v / total);
  if (!fractions.every((f) => Number.isFinite(f) && f >= 0)) {
    return { methodology: 'MANUAL', weights: [], excluded, ok: false, error: 'INVALID_INPUT' };
  }

  const bps = toBasisPoints(
    included.map((e, i) => ({
      id: e.stockTokenId || e.ticker || String(i),
      fraction: fractions[i]!,
    })),
    maxBps,
  );
  const sum = bps.reduce((s, b) => s + b, 0);
  if (sum !== WEIGHT_DENOMINATOR_BPS || bps.some((b) => b > maxBps || b < 0)) {
    return { methodology: 'MANUAL', weights: [], excluded, ok: false, error: 'INVARIANT_FAILED' };
  }
  return {
    methodology: 'MANUAL',
    weights: included.map((e, i) => ({
      stockTokenId: e.stockTokenId,
      ticker: e.ticker,
      weightBps: bps[i]!,
    })),
    excluded,
    ok: true,
  };
}
