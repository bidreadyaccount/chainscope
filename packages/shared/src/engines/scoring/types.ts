/** Raw component values feeding the opportunity score (SPEC §12). */
export interface OpportunityComponents {
  /** Smart-money net flow (USD, signed). */
  readonly smartMoneyNetFlowUsd: number;
  /** Whale net flow (USD, signed). */
  readonly whaleNetFlowUsd: number;
  /** Unique-buyer growth vs prior window (fraction, e.g. 0.5 = +50%). */
  readonly uniqueBuyerGrowth: number;
  /** Buy/sell imbalance in [-1, 1] = (buyVol - sellVol)/(buyVol + sellVol). */
  readonly buySellImbalance: number;
  /** Liquidity growth (fraction, signed). */
  readonly liquidityGrowthPct: number;
  /** Buyer-quality improvement (points on the 0..100 wallet-quality scale). */
  readonly buyerQualityImprovement: number;
  /** Volume acceleration (fraction, signed). */
  readonly volumeAcceleration: number;
  /** Price confirmation (fraction, signed price change aligned with flow). */
  readonly priceConfirmation: number;
}

/** Risk evidence feeding penalties and the separate risk score (SPEC §12). */
export interface RiskInputs {
  /** Deployer-linked net flow (USD); negative = deployer selling. */
  readonly deployerLinkedNetFlowUsd: number;
  /** Liquidity change fraction; negative = removal. */
  readonly liquidityChangePct: number;
  /** Buyer concentration (0..1, top-N share). */
  readonly buyerConcentration: number;
  /** Seller concentration (0..1, top-N share). */
  readonly sellerConcentration: number;
  /** Wash-trading likelihood (0..1). */
  readonly washTradingScore?: number;
  /** Related-wallet share of volume (0..1). */
  readonly relatedWalletConcentration?: number;
  /** Pool liquidity (USD); null = unknown. */
  readonly liquidityUsd?: number | null;
  /** Contract verified? Undefined/true = assume verified (no penalty). */
  readonly contractVerified?: boolean;
  /** Abnormal transfer restrictions detected? */
  readonly abnormalTransferRestrictions?: boolean;
  /** Price confidence (0..100). */
  readonly priceConfidence: number;
  /** Data-confidence score (0..100). */
  readonly dataConfidenceScore: number;
}

export interface OpportunityInput {
  readonly components: OpportunityComponents;
  readonly risk: RiskInputs;
}

export interface ComponentBreakdown {
  readonly key: string;
  readonly raw: number;
  readonly normalized: number;
  readonly weight: number;
  readonly contribution: number;
}

export interface PenaltyBreakdown {
  readonly key: string;
  readonly applied: number;
  readonly maxPenalty: number;
  readonly severity: number;
  readonly evidence: string;
}

export interface ScoreResult {
  /** Final opportunity score, clamped 0..100. */
  readonly score: number;
  /** score before the 0..100 clamp (base − penalties). */
  readonly scorePreClamp: number;
  /** Weighted component sum (0..100), before penalties. */
  readonly baseScore: number;
  readonly signal: string;
  readonly components: readonly ComponentBreakdown[];
  readonly penalties: readonly PenaltyBreakdown[];
  readonly totalPenalty: number;
  /** Separate risk score, 0..100. */
  readonly riskScore: number;
}
