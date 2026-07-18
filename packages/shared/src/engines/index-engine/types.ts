/**
 * Index-engine types. All prices/market caps are USD numbers (derived display
 * values); weights are integer basis points summing to exactly 10000.
 */

import type { IndexMethodology } from '@chainscope/config';

/** One constituent's inputs for weighting + valuation. */
export interface ConstituentInput {
  readonly stockTokenId: string;
  readonly ticker: string;
  readonly sector: string;
  readonly priceUsd: number | null;
  readonly marketCapUsd: number | null;
  /** Annualized volatility as a fraction (e.g. 0.28), for INVERSE_VOL. */
  readonly volatility: number | null;
}

/** A computed weight for one constituent. */
export interface ConstituentWeight {
  readonly stockTokenId: string;
  readonly ticker: string;
  readonly weightBps: number;
}

/** A constituent excluded from weighting, with a machine-readable reason. */
export interface ExcludedConstituent {
  readonly stockTokenId: string;
  readonly ticker: string;
  readonly reason:
    | 'MISSING_PRICE'
    | 'MISSING_MARKET_CAP'
    | 'MISSING_VOLATILITY'
    | 'NON_POSITIVE'
    | 'NON_FINITE';
}

/** Index-level failure reason when weights could not be produced. */
export type WeightError = 'CAP_INFEASIBLE' | 'INVALID_INPUT' | 'INVARIANT_FAILED';

export interface WeightResult {
  /** The methodology used, or 'MANUAL' for user-supplied builder weights. */
  readonly methodology: IndexMethodology | 'MANUAL';
  readonly weights: ConstituentWeight[];
  readonly excluded: ExcludedConstituent[];
  /** True when weights were produced (>= minConstituents survived). */
  readonly ok: boolean;
  /** Present when ok is false for an index-level reason (not per-constituent). */
  readonly error?: WeightError;
}

/** A constituent dropped from a basket at construction, with a reason. */
export interface ExcludedHolding {
  readonly stockTokenId: string;
  readonly ticker: string;
  readonly weightBps: number;
  readonly reason: 'MISSING_PRICE' | 'NON_FINITE_PRICE';
}

/** Notional share holdings that realize a set of weights at given prices. */
export interface Basket {
  readonly holdings: Array<{
    stockTokenId: string;
    ticker: string;
    shares: number;
    weightBps: number;
  }>;
  /** Constituents with no usable price — excluded from the basket, surfaced not silent. */
  readonly excluded: ExcludedHolding[];
  /** Sum of the invested constituents' weights (< 10000 when some were excluded). */
  readonly investedWeightBps: number;
  readonly divisor: number;
  readonly navUsd: number;
  readonly level: number;
}

export interface LevelResult {
  readonly navUsd: number;
  readonly level: number;
}

export interface SectorAllocation {
  readonly sector: string;
  readonly weightBps: number;
}

export interface ConcentrationResult {
  readonly top1Bps: number;
  readonly top5Bps: number;
  /** Herfindahl-Hirschman Index on weight fractions (0..1). */
  readonly hhi: number;
  /** Effective number of constituents = 1 / HHI. */
  readonly effectiveN: number;
}

export interface PerformancePoint {
  readonly takenAt: number; // epoch ms
  readonly level: number;
}

export interface PerformanceResult {
  /** Returns per window as a fraction (e.g. 0.042 = +4.2%); null if unavailable. */
  readonly returns: Record<string, number | null>;
  /** Annualized volatility of daily returns (fraction); null if < 2 points. */
  readonly annualizedVolatility: number | null;
  /** Maximum peak-to-trough drawdown as a negative fraction; null if < 2 points. */
  readonly maxDrawdown: number | null;
  readonly latestLevel: number | null;
  readonly firstLevel: number | null;
}
