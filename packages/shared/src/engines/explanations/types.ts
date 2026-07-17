import type { TimeWindow } from '@chainscope/config';
import type { TokenMetrics } from '../metrics/types.js';
import type { ScoreResult } from '../scoring/types.js';

/**
 * Optional participant counts that make sentences richer ("Four smart-money
 * wallets..."). All optional — the generator degrades gracefully without them.
 */
export interface ExplanationCounts {
  readonly smartMoneyBuyers?: number;
  readonly whaleBuyers?: number;
  readonly deployerSellers?: number;
}

export interface ExplanationInput {
  readonly metrics: TokenMetrics;
  readonly score: ScoreResult;
  readonly window?: TimeWindow;
  readonly counts?: ExplanationCounts;
  /** Pool liquidity (USD) — used for the very-low-liquidity risk sentence. */
  readonly liquidityUsd?: number | null;
  /** Price confidence (0..100) — for the unreliable-price sentence. */
  readonly priceConfidence?: number;
}

export interface Explanations {
  readonly positiveFactors: string[];
  readonly riskFactors: string[];
}
