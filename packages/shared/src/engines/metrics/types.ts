import type { TimeWindow } from '@chainscope/config';
import type { WalletClass } from '../../types/wallet.js';

/** A single trade projected into the fields the metrics engine needs. */
export interface MetricTrade {
  readonly side: 'BUY' | 'SELL';
  /** USD value; null when unpriced. Unpriced trades are counted but add 0 USD. */
  readonly valueUsd: number | null;
  /** 0..100 price confidence for this trade. */
  readonly priceConfidence: number;
  readonly walletClass: WalletClass;
  readonly traderAddress: string;
  readonly timestamp: number;
}

/** Prior-window reference values for delta metrics. */
export interface MetricPriorReference {
  readonly uniqueBuyers?: number;
  readonly walletQualityScore?: number;
  readonly priceUsd?: number | null;
  readonly liquidityUsd?: number | null;
}

export interface TokenMetricsOptions {
  /** Include market-maker flow in directional net-flow metrics. Default false. */
  readonly includeMarketMakerFlow?: boolean;
  /** Include protocol flow in directional net-flow metrics. Default false. */
  readonly includeProtocolFlow?: boolean;
}

export interface TokenMetricsInput {
  readonly window: TimeWindow;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly trades: readonly MetricTrade[];
  readonly prior?: MetricPriorReference;
  readonly currentPriceUsd?: number | null;
  readonly currentLiquidityUsd?: number | null;
  /** Comparable baseline USD volume for volume-acceleration. */
  readonly baselineVolumeUsd?: number;
  /** Optional holder counts for holder-growth (null when unavailable). */
  readonly holdersNow?: number | null;
  readonly holdersPrior?: number | null;
  readonly options?: TokenMetricsOptions;
}

export interface TokenMetrics {
  readonly window: TimeWindow;
  readonly windowStartMs: number;
  readonly windowEndMs: number;

  readonly buyVolumeUsd: number;
  readonly sellVolumeUsd: number;
  /** Directional net flow — excludes MM/protocol by default (see options). */
  readonly netFlowUsd: number;

  readonly buys: number;
  readonly sells: number;
  readonly uniqueBuyers: number;
  readonly uniqueSellers: number;
  readonly buySellRatio: number | null;

  readonly whaleBuyVolumeUsd: number;
  readonly whaleSellVolumeUsd: number;
  readonly whaleNetFlowUsd: number;

  readonly smartMoneyBuyVolumeUsd: number;
  readonly smartMoneySellVolumeUsd: number;
  readonly smartMoneyNetFlowUsd: number;

  readonly retailNetFlowUsd: number;
  readonly newWalletNetFlowUsd: number;
  readonly botAssociatedVolumeUsd: number;
  readonly deployerLinkedNetFlowUsd: number;
  readonly marketMakerVolumeUsd: number;
  readonly protocolVolumeUsd: number;

  readonly avgTradeSizeUsd: number;
  readonly medianTradeSizeUsd: number;

  readonly priceChangePct: number | null;
  readonly volumeAcceleration: number | null;
  readonly liquidityChangePct: number | null;
  readonly holderGrowth: number | null;

  readonly buyerConcentration: number;
  readonly sellerConcentration: number;

  readonly walletQualityScore: number;
  readonly dataConfidenceScore: number;

  readonly uniqueBuyerGrowth: number | null;
  readonly buyerQualityImprovement: number | null;

  readonly tradeCount: number;
  readonly pricedTradeCount: number;
}
