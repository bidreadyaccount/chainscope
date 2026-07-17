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
  // SIGNAL_BANDS is ordered highest-first; match on the lower bound only so
  // fractional scores in a band's interior (e.g. 79.99) resolve to the correct
  // band instead of falling into the integer gap between `max` and the next
  // band's `min`. 79.99 → 'Positive accumulation'; 80 → 'Strong accumulation'.
  for (const band of SIGNAL_BANDS) {
    if (clamped >= band.min) return band.label;
  }
  return SIGNAL_BANDS[SIGNAL_BANDS.length - 1]?.label ?? 'Strong distribution';
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

// ---------------------------------------------------------------------------
// SPEC §8 — Bot indicator scoring weights (points toward a 0–100 probability).
// The BOT_INDICATORS block above holds the *thresholds* that decide whether an
// indicator fires; these are the *weights* each fired indicator contributes.
// Deliberately over-sum (>100) so a few strong signals saturate; probability is
// clamped to 100. Engines must not hardcode these.
// ---------------------------------------------------------------------------

export interface BotIndicatorWeights {
  readonly launchBlockPurchase: number;
  readonly extremelyShortReaction: number;
  readonly repeatedIdenticalAmounts: number;
  readonly abnormalTxFrequency: number;
  readonly repetitiveRouterTokenPattern: number;
  readonly clusterFunding: number;
  readonly veryShortHolding: number;
}

export const BOT_INDICATOR_WEIGHTS: BotIndicatorWeights = {
  launchBlockPurchase: 25,
  extremelyShortReaction: 25,
  repeatedIdenticalAmounts: 20,
  abnormalTxFrequency: 20,
  repetitiveRouterTokenPattern: 15,
  clusterFunding: 15,
  veryShortHolding: 15,
};

// ---------------------------------------------------------------------------
// SPEC §8 — Deployer-linked evidence weights (points toward a 0–100 confidence).
// ---------------------------------------------------------------------------

export interface DeployerEvidenceWeights {
  readonly fundedByDeployer: number;
  readonly earlyAllocation: number;
  readonly preLaunchInteraction: number;
  readonly sharedFundingSource: number;
  readonly liquidityManagement: number;
}

export const DEPLOYER_EVIDENCE_WEIGHTS: DeployerEvidenceWeights = {
  fundedByDeployer: 45,
  earlyAllocation: 25,
  preLaunchInteraction: 30,
  sharedFundingSource: 20,
  liquidityManagement: 20,
};

// ---------------------------------------------------------------------------
// SPEC §8 — Smart-money component normalization scales (deterministic, bounded).
// ROI and risk-adjusted return are mapped through 0.5 + 0.5*tanh(x/scale) so a
// zero value maps to 0.5 and large magnitudes saturate toward 0/1.
// ---------------------------------------------------------------------------

export interface SmartMoneyNormalization {
  /** ROI fraction (realized/invested) at which profitability ~saturates. */
  readonly roiScale: number;
  /** Risk-adjusted (return/stddev) ratio scale. */
  readonly riskAdjustedScale: number;
  /** Closed-position count mapped via log to a 0..1 trade-count confidence. */
  readonly tradeCountTarget: number;
}

export const SMART_MONEY_NORMALIZATION: SmartMoneyNormalization = {
  roiScale: 1.0, // 100% ROI → ~0.88
  riskAdjustedScale: 2.0,
  tradeCountTarget: 30,
};

// ---------------------------------------------------------------------------
// SPEC §10 — Wallet-quality weighting: per-class quality contribution (0..1)
// used to compute a token's volume-weighted wallet-quality score.
// ---------------------------------------------------------------------------

export type WalletClassName = (typeof WALLET_CLASS_PRECEDENCE)[number];

export const WALLET_QUALITY_WEIGHTS: Record<WalletClassName, number> = {
  PROTOCOL: 0.5,
  MARKET_MAKER: 0.5,
  DEPLOYER_LINKED: 0.2,
  BOT: 0.15,
  MEGA_WHALE: 0.9,
  WHALE: 0.85,
  SMART_MONEY: 1.0,
  LARGE_TRADER: 0.65,
  NEW_WALLET: 0.35,
  RETAIL: 0.45,
  UNKNOWN: 0.3,
};

// ---------------------------------------------------------------------------
// SPEC §10 — Data-confidence blend + top-N concentration cohort size.
// ---------------------------------------------------------------------------

export interface DataConfidenceWeights {
  /** Weight on average price-confidence coverage (0..1). */
  readonly priceCoverage: number;
  /** Weight on sample-size adequacy (0..1). */
  readonly sampleSize: number;
}

export const DATA_CONFIDENCE_WEIGHTS: DataConfidenceWeights = {
  priceCoverage: 0.6,
  sampleSize: 0.4,
};

/** Cohort size for buyer/seller concentration (top-N share of volume). */
export const CONCENTRATION_TOP_N = 5;

// ---------------------------------------------------------------------------
// SPEC §12 — Opportunity component normalization scales. Signed components are
// mapped via 0.5 + 0.5*tanh(raw/scale); a zero raw value → neutral 0.5.
// Bounded [-1,1] components (buy/sell imbalance) skip tanh and map linearly.
// ---------------------------------------------------------------------------

export interface OpportunityNormalization {
  /** USD net-flow scale for smart-money / whale flow. */
  readonly netFlowUsdScale: number;
  /** Unique-buyer growth fraction scale. */
  readonly uniqueBuyerGrowthScale: number;
  /** Liquidity growth fraction scale. */
  readonly liquidityGrowthScale: number;
  /** Buyer-quality improvement scale (points on the 0..100 quality scale). */
  readonly buyerQualityScale: number;
  /** Volume acceleration fraction scale. */
  readonly volumeAccelerationScale: number;
  /** Price confirmation fraction scale. */
  readonly priceConfirmationScale: number;
}

export const OPPORTUNITY_NORMALIZATION: OpportunityNormalization = {
  netFlowUsdScale: 100_000,
  uniqueBuyerGrowthScale: 0.5,
  liquidityGrowthScale: 0.25,
  buyerQualityScale: 20,
  volumeAccelerationScale: 1.0,
  priceConfirmationScale: 0.15,
};

// ---------------------------------------------------------------------------
// SPEC §16 — Deterministic explanation significance thresholds. A factor is
// only emitted when the underlying metric crosses one of these. No LLM, no
// magic numbers inside the generator itself.
// ---------------------------------------------------------------------------

export const EXPLANATION_THRESHOLDS = {
  /** Net flow (USD, abs) above which a directional flow is worth stating. */
  significantNetFlowUsd: 10_000,
  /** Unique-buyer growth fraction considered a positive factor. */
  strongBuyerGrowth: 0.25,
  /** Buy/sell imbalance (0..1 abs) considered a positive/negative factor. */
  strongImbalance: 0.3,
  /** Liquidity growth fraction worth stating positively. */
  significantLiquidityGrowth: 0.1,
  /** Volume acceleration fraction worth stating. */
  significantVolumeAcceleration: 0.5,
  /** Buyer-quality improvement (points) worth stating. */
  buyerQualityImprovement: 5,
  /** Wallet-quality score above which the participant mix is "high quality". */
  strongWalletQuality: 70,
} as const;

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
  botIndicatorWeights: BOT_INDICATOR_WEIGHTS,
  deployerEvidenceWeights: DEPLOYER_EVIDENCE_WEIGHTS,
  smartMoneyNormalization: SMART_MONEY_NORMALIZATION,
  walletQualityWeights: WALLET_QUALITY_WEIGHTS,
  dataConfidenceWeights: DATA_CONFIDENCE_WEIGHTS,
  concentrationTopN: CONCENTRATION_TOP_N,
  opportunityWeights: OPPORTUNITY_WEIGHTS,
  opportunityNormalization: OPPORTUNITY_NORMALIZATION,
  riskPenalties: RISK_PENALTIES,
  riskTriggers: RISK_TRIGGERS,
  signalBands: SIGNAL_BANDS,
  priceSourceConfidence: PRICE_SOURCE_CONFIDENCE,
  minDisplayablePriceConfidence: MIN_DISPLAYABLE_PRICE_CONFIDENCE,
  minTokenDataConfidence: MIN_TOKEN_DATA_CONFIDENCE,
  metrics: METRICS_CONFIG,
  explanations: EXPLANATION_THRESHOLDS,
} as const;
