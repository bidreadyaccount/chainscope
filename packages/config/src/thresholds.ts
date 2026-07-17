/**
 * ALL classification, scoring, pricing and signal thresholds live here as
 * typed, configurable constants. Engines (packages/shared) import from this
 * module — no engine should hardcode a magic number that belongs here.
 *
 * Sources: SPEC §7 (signal labels), §8 (wallet classification + smart money +
 * bot indicators), §11 (pricing confidence), §12 (opportunity score weights +
 * risk penalties). BUILD_BRIEF §Interface contracts pins the score labels.
 *
 * USD thresholds are plain `number` (derived USD values, per numeric-safety
 * rule). Raw onchain quantities are never expressed here.
 */

import type { TimeWindow } from './time-windows.js';

// ---------------------------------------------------------------------------
// SPEC §8 — Wallet classification thresholds (USD)
// ---------------------------------------------------------------------------

export interface WhaleTierThresholds {
  /** Portfolio value at/above which the tier applies. */
  readonly portfolioUsd: number;
  /** Any single trade at/above which the tier applies. */
  readonly singleTradeUsd: number;
  /** Fraction (0..1) of tracked circulating supply controlled. */
  readonly supplyControlFraction: number;
}

export interface WalletClassificationThresholds {
  readonly megaWhale: WhaleTierThresholds;
  readonly whale: WhaleTierThresholds;
  readonly largeTrader: {
    readonly typicalTradeUsd: number;
    readonly portfolioUsd: number;
  };
  readonly retail: {
    readonly portfolioUsdBelow: number;
    readonly typicalTradeUsdBelow: number;
  };
  readonly newWallet: {
    /** First observed tx within the previous N days. */
    readonly firstSeenWithinDays: number;
    /** OR fewer than N lifetime observed transactions. */
    readonly maxLifetimeTxs: number;
  };
}

export const WALLET_THRESHOLDS: WalletClassificationThresholds = {
  megaWhale: {
    portfolioUsd: 1_000_000,
    singleTradeUsd: 100_000,
    supplyControlFraction: 0.02, // 2%
  },
  whale: {
    portfolioUsd: 250_000,
    singleTradeUsd: 25_000,
    supplyControlFraction: 0.01, // 1%
  },
  largeTrader: {
    typicalTradeUsd: 5_000,
    portfolioUsd: 50_000,
  },
  retail: {
    portfolioUsdBelow: 10_000,
    typicalTradeUsdBelow: 1_000,
  },
  newWallet: {
    firstSeenWithinDays: 7,
    maxLifetimeTxs: 5,
  },
};

// ---------------------------------------------------------------------------
// SPEC §8 — Smart-money scoring weights (sum = 1.0) + status thresholds
// ---------------------------------------------------------------------------

export interface SmartMoneyWeights {
  readonly realizedProfitability: number;
  readonly winRate: number;
  readonly entryTiming: number;
  readonly consistency: number;
  readonly tradeCountConfidence: number;
  readonly riskAdjustedReturn: number;
}

export const SMART_MONEY_WEIGHTS: SmartMoneyWeights = {
  realizedProfitability: 0.3,
  winRate: 0.2,
  entryTiming: 0.15,
  consistency: 0.15,
  tradeCountConfidence: 0.1,
  riskAdjustedReturn: 0.1,
};

/** Minimum closed positions before a smart-money score is meaningful. */
export const SMART_MONEY_MIN_SAMPLE_SIZE = 5;

/** Smart-money confirmation ladder, keyed by the 0–100 composite score. */
export const SMART_MONEY_STATUS_THRESHOLDS = {
  candidate: 40,
  emerging: 60,
  confirmed: 75,
} as const;

export type SmartMoneyStatus = 'None' | 'Candidate' | 'Emerging' | 'Confirmed';

// ---------------------------------------------------------------------------
// SPEC §8 — Bot probability indicators (explainable, configurable)
// ---------------------------------------------------------------------------

export interface BotIndicatorThresholds {
  /** Reaction time (ms) below which a trade looks automated. */
  readonly maxReactionTimeMs: number;
  /** Trades per hour above which frequency is abnormal. */
  readonly abnormalTxPerHour: number;
  /** Identical trade-size repetitions to flag repeated-amount behaviour. */
  readonly repeatedAmountCount: number;
  /** Relative tolerance for "identical" trade sizes (0..1). */
  readonly identicalAmountTolerance: number;
  /** Holding period (seconds) below which holds are "very short". */
  readonly veryShortHoldSeconds: number;
  /** Wallets funded by a single source to flag a funded cluster. */
  readonly clusterFundingWalletCount: number;
  /** Bot probability (0..100) at/above which "Possible bot" label is applied. */
  readonly labelProbability: number;
}

export const BOT_INDICATORS: BotIndicatorThresholds = {
  maxReactionTimeMs: 2_000,
  abnormalTxPerHour: 30,
  repeatedAmountCount: 5,
  identicalAmountTolerance: 0.01, // 1%
  veryShortHoldSeconds: 60,
  clusterFundingWalletCount: 5,
  labelProbability: 65,
};

// ---------------------------------------------------------------------------
// SPEC §8 — Deployer-linked / relationship evidence thresholds
// ---------------------------------------------------------------------------

export interface DeployerLinkThresholds {
  /** Interaction before public trading counts as strong evidence. */
  readonly preLaunchInteraction: boolean;
  /** Early allocation fraction (0..1) considered notable. */
  readonly earlyAllocationFraction: number;
  /** Confidence (0..100) required to surface the "Deployer-linked" label. */
  readonly labelConfidence: number;
}

export const DEPLOYER_LINK: DeployerLinkThresholds = {
  preLaunchInteraction: true,
  earlyAllocationFraction: 0.005, // 0.5% of supply
  labelConfidence: 50,
};

/**
 * Wallet-classification precedence (SPEC §7 requires an explicit primary).
 * Earlier entries win when multiple labels apply.
 */
export const WALLET_CLASS_PRECEDENCE = [
  'PROTOCOL',
  'MARKET_MAKER',
  'DEPLOYER_LINKED',
  'BOT',
  'MEGA_WHALE',
  'WHALE',
  'SMART_MONEY',
  'LARGE_TRADER',
  'NEW_WALLET',
  'RETAIL',
  'UNKNOWN',
] as const;

// ---------------------------------------------------------------------------
// SPEC §12 — Opportunity score component weights (sum = 1.0, pre-penalty)
// ---------------------------------------------------------------------------

export interface OpportunityWeights {
  readonly smartMoneyNetFlow: number;
  readonly whaleNetFlow: number;
  readonly uniqueBuyerGrowth: number;
  readonly buySellImbalance: number;
  readonly liquidityGrowth: number;
  readonly buyerQualityImprovement: number;
  readonly volumeAcceleration: number;
  readonly priceConfirmation: number;
}

export const OPPORTUNITY_WEIGHTS: OpportunityWeights = {
  smartMoneyNetFlow: 0.25,
  whaleNetFlow: 0.2,
  uniqueBuyerGrowth: 0.15,
  buySellImbalance: 0.1,
  liquidityGrowth: 0.1,
  buyerQualityImprovement: 0.1,
  volumeAcceleration: 0.05,
  priceConfirmation: 0.05,
};

// ---------------------------------------------------------------------------
// SPEC §12 — Risk penalties (points subtracted from the 0–100 opportunity
// score) and the separate 0–100 risk score contributions.
// ---------------------------------------------------------------------------

export interface RiskPenalties {
  readonly deployerLinkedSelling: number;
  readonly liquidityRemoval: number;
  readonly extremeHolderConcentration: number;
  readonly washTradingLikelihood: number;
  readonly relatedWalletConcentration: number;
  readonly veryLowLiquidity: number;
  readonly unverifiedContract: number;
  readonly abnormalTransferRestrictions: number;
  readonly unreliablePrice: number;
  readonly insufficientHistory: number;
}

/** Max points each risk factor can subtract from the opportunity score. */
export const RISK_PENALTIES: RiskPenalties = {
  deployerLinkedSelling: 20,
  liquidityRemoval: 20,
  extremeHolderConcentration: 15,
  washTradingLikelihood: 15,
  relatedWalletConcentration: 10,
  veryLowLiquidity: 15,
  unverifiedContract: 10,
  abnormalTransferRestrictions: 15,
  unreliablePrice: 10,
  insufficientHistory: 10,
};

/** Thresholds that trigger the corresponding risk factor. */
export const RISK_TRIGGERS = {
  /** Buyer/seller concentration (0..1) considered "extreme". */
  extremeConcentrationFraction: 0.6,
  /** Related-wallet share of volume (0..1) considered concentrated. */
  relatedWalletConcentrationFraction: 0.4,
  /** Pool liquidity (USD) below which liquidity is "very low". */
  veryLowLiquidityUsd: 25_000,
  /** Liquidity drop (fraction of pool, 0..1) treated as removal. */
  liquidityRemovalFraction: 0.2,
  /** Data-confidence (0..100) below which history is "insufficient". */
  insufficientHistoryConfidence: 40,
} as const;

// ---------------------------------------------------------------------------
// BUILD_BRIEF + SPEC §12 — Opportunity signal labels (0–100)
// ---------------------------------------------------------------------------

export interface SignalBand {
  readonly min: number;
  readonly max: number;
  readonly label: string;
}

export const SIGNAL_BANDS: readonly SignalBand[] = [
  { min: 80, max: 100, label: 'Strong accumulation' },
  { min: 65, max: 79, label: 'Positive accumulation' },
  { min: 50, max: 64, label: 'Mixed' },
  { min: 35, max: 49, label: 'Elevated selling' },
  { min: 0, max: 34, label: 'Strong distribution' },
];

export function signalLabel(score: number): string {
  const clamped = Math.max(0, Math.min(100, score));
  for (const band of SIGNAL_BANDS) {
    if (clamped >= band.min && clamped <= band.max) return band.label;
  }
  return 'Mixed';
}

// ---------------------------------------------------------------------------
// SPEC §11 — Price confidence tiers (0..100) by price source
// ---------------------------------------------------------------------------

export type PriceSource =
  | 'STABLE_POOL'
  | 'NATIVE_PAIR'
  | 'DEEPEST_POOL'
  | 'TIME_WEIGHTED'
  | 'UNKNOWN';

export const PRICE_SOURCE_CONFIDENCE: Record<PriceSource, number> = {
  STABLE_POOL: 95,
  NATIVE_PAIR: 80,
  DEEPEST_POOL: 65,
  TIME_WEIGHTED: 45,
  UNKNOWN: 0,
};

/** Below this price confidence, display "Insufficient pricing data". */
export const MIN_DISPLAYABLE_PRICE_CONFIDENCE = 25;

/** Below this data-confidence, mark token metrics as low confidence. */
export const MIN_TOKEN_DATA_CONFIDENCE = 40;

// ---------------------------------------------------------------------------
// Metrics/aggregation tunables
// ---------------------------------------------------------------------------

export interface MetricsConfig {
  /** Windows over which token metrics are computed. */
  readonly windows: readonly TimeWindow[];
  /** Minimum trades in a window before metrics are considered reliable. */
  readonly minTradesForConfidence: number;
  /** Baseline window used for volume-acceleration comparison. */
  readonly volumeAccelerationBaseline: TimeWindow;
}

export const METRICS_CONFIG: MetricsConfig = {
  windows: ['1m', '5m', '15m', '1h', '4h', '24h'],
  minTradesForConfidence: 10,
  volumeAccelerationBaseline: '1h',
};

/**
 * Single aggregate export so consumers can import one object if preferred.
 * Individual named exports remain the primary interface.
 */
export const THRESHOLDS = {
  wallet: WALLET_THRESHOLDS,
  smartMoneyWeights: SMART_MONEY_WEIGHTS,
  smartMoneyMinSampleSize: SMART_MONEY_MIN_SAMPLE_SIZE,
  smartMoneyStatus: SMART_MONEY_STATUS_THRESHOLDS,
  bot: BOT_INDICATORS,
  deployerLink: DEPLOYER_LINK,
  walletClassPrecedence: WALLET_CLASS_PRECEDENCE,
  opportunityWeights: OPPORTUNITY_WEIGHTS,
  riskPenalties: RISK_PENALTIES,
  riskTriggers: RISK_TRIGGERS,
  signalBands: SIGNAL_BANDS,
  priceSourceConfidence: PRICE_SOURCE_CONFIDENCE,
  minDisplayablePriceConfidence: MIN_DISPLAYABLE_PRICE_CONFIDENCE,
  minTokenDataConfidence: MIN_TOKEN_DATA_CONFIDENCE,
  metrics: METRICS_CONFIG,
} as const;
