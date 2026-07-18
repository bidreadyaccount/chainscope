/**
 * Stock-token index-layer configuration. Weighting methodologies, default
 * constraints, and performance-window definitions for the index engine. Kept in
 * config (not hardcoded in the engine) so methodology parameters are auditable
 * and adjustable in one place.
 */

/** Supported index weighting methodologies. */
export const INDEX_METHODOLOGIES = [
  'EQUAL', // 1/N
  'MARKET_CAP', // proportional to market cap
  'PRICE', // proportional to share price (DJIA-style)
  'INVERSE_VOL', // proportional to 1/volatility (risk-weighted)
  'CAP_CAPPED', // market-cap weighted, capped per constituent with redistribution
] as const;

export type IndexMethodology = (typeof INDEX_METHODOLOGIES)[number];

/** Basis-point denominator: all index weights sum to exactly this. */
export const WEIGHT_DENOMINATOR_BPS = 10_000;

export interface IndexConstraints {
  /** Maximum single-constituent weight, basis points (default: no cap = 10000). */
  readonly maxWeightBps: number;
  /** Minimum constituents required to build an index. */
  readonly minConstituents: number;
}

export const DEFAULT_INDEX_CONSTRAINTS: IndexConstraints = {
  maxWeightBps: WEIGHT_DENOMINATOR_BPS,
  minConstituents: 2,
};

/**
 * Iteration cap for the CAP_CAPPED redistribution loop. Redistribution of
 * capped excess to uncapped names is monotonic and converges quickly; this is a
 * safety bound so a degenerate input can never loop unbounded.
 */
export const CAP_REDISTRIBUTION_MAX_ITERATIONS = 64;

/** Performance windows for index return series, in days. */
export const INDEX_PERFORMANCE_WINDOWS = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  ytd: null, // computed from Jan 1 of the series' latest year
} as const;

export type IndexPerformanceWindow = keyof typeof INDEX_PERFORMANCE_WINDOWS;

/**
 * Trading days per year, used to annualize the volatility of a daily index
 * return series. 252 is the standard US-equity convention.
 */
export const TRADING_DAYS_PER_YEAR = 252;
