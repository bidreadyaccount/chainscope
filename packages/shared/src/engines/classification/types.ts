import type { SmartMoneyStatus } from '@chainscope/config';

/**
 * Timing / behavioural statistics used for bot detection (SPEC §8). All fields
 * optional — an absent field simply means that indicator cannot fire.
 */
export interface WalletTimingStats {
  /** Fastest observed reaction time to a new pool/price signal, in ms. */
  readonly minReactionTimeMs?: number;
  /** Did the wallet buy in the token's launch block? */
  readonly boughtInLaunchBlock?: boolean;
  /** Peak observed trades per hour. */
  readonly txPerHourPeak?: number;
  /** Max run of near-identical trade sizes (repeated-amount behaviour). */
  readonly identicalAmountRepeats?: number;
  /** Repetitive router/token interaction pattern flagged upstream. */
  readonly repetitiveRouterTokenPattern?: boolean;
  /** Shortest observed holding period, in seconds. */
  readonly shortestHoldSeconds?: number;
}

/** Precomputed profitability inputs for smart-money scoring (SPEC §8/§9). */
export interface SmartMoneyInput {
  /** Total realized profit across closed positions (USD). */
  readonly realizedProfitUsd: number;
  /** Total USD cost basis deployed into closed positions (for ROI). */
  readonly investedUsd: number;
  /** Number of closed positions — the sample-size gate operand. */
  readonly closedPositions: number;
  /** Closed positions that ended in profit. */
  readonly winningPositions: number;
  /** Closed positions that ended in loss. */
  readonly losingPositions: number;
  /** 0..1 quality of entry timing (buying dips / early). Default 0.5. */
  readonly entryTimingScore?: number;
  /** 0..1 consistency of returns across positions. Default 0.5. */
  readonly consistencyScore?: number;
  /** Mean return per position (fraction) — numerator of risk-adjusted. */
  readonly avgReturnPerPosition?: number;
  /** Std-dev of per-position returns (fraction) — denominator. */
  readonly returnStdDev?: number;
}

/**
 * Wallet activity summary — the plain typed input to `classifyWallet`. The API
 * / indexer assembles this from wallet history; the engine performs no I/O.
 */
export interface WalletActivitySummary {
  readonly address: string;
  /** Estimated total portfolio value (USD). */
  readonly portfolioValueUsd: number;
  /** Recent trade sizes (USD); used for typical/single-trade thresholds. */
  readonly tradeSizesUsd: readonly number[];
  /** Explicit largest single trade (USD); falls back to max(tradeSizesUsd). */
  readonly largestTradeUsd?: number;
  /** Days since first observed transaction. */
  readonly firstSeenDaysAgo: number;
  /** Lifetime observed transaction count. */
  readonly txCount: number;
  /** Max fraction (0..1) of any tracked token supply this wallet controls. */
  readonly maxSupplyControlFraction?: number;

  // Relationship / cluster evidence
  readonly fundingSourceSharedCount?: number;
  readonly isFundedByDeployer?: boolean;
  readonly hasEarlyTokenAllocation?: boolean;
  readonly interactedBeforePublicTrading?: boolean;
  readonly hasLiquidityManagementRelationship?: boolean;

  // Known-entity flags (resolved from a registry upstream)
  readonly isKnownMarketMaker?: boolean;
  readonly isKnownProtocol?: boolean;

  // Behavioural
  readonly timing?: WalletTimingStats;

  // Profitability
  readonly smartMoney?: SmartMoneyInput;
}

/** One explainable indicator evaluated during bot scoring. */
export interface BotIndicatorResult {
  readonly key: string;
  readonly triggered: boolean;
  readonly weight: number;
  readonly detail: string;
}

/** Result of bot-probability scoring. */
export interface BotScore {
  /** 0..100 probability the wallet is automated. */
  readonly probability: number;
  readonly indicators: readonly BotIndicatorResult[];
  /** Hedged human reasons for each fired indicator. */
  readonly reasons: readonly string[];
}

/** One weighted smart-money component (raw → normalized → contribution). */
export interface SmartMoneyComponent {
  readonly key: string;
  readonly raw: number;
  readonly normalized: number;
  readonly weight: number;
  readonly contribution: number;
}

/** Result of smart-money scoring. */
export interface SmartMoneyScore {
  /** 0..100 composite score (0 when below the sample-size gate). */
  readonly score: number;
  readonly status: SmartMoneyStatus;
  /** True when closedPositions met the minimum sample-size gate. */
  readonly sampleSizeMet: boolean;
  readonly closedPositions: number;
  readonly winRate: number;
  readonly components: readonly SmartMoneyComponent[];
  readonly reasons: readonly string[];
}
