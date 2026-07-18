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
  readonly reason: 'MISSING_PRICE' | 'MISSING_MARKET_CAP' | 'MISSING_VOLATILITY' | 'NON_POSITIVE';
}

export interface WeightResult {
  readonly methodology: IndexMethodology;
  readonly weights: ConstituentWeight[];
  readonly excluded: ExcludedConstituent[];
  /** True when weights were produced (>= minConstituents survived). */
  readonly ok: boolean;
}

/** Notional share holdings that realize a set of weights at given prices. */
export interface Basket {
  readonly holdings: Array<{
    stockTokenId: string;
    ticker: string;
    shares: number;
    weightBps: number;
  }>;
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
