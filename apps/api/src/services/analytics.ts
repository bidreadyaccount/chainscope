/**
 * Analytics wiring — the single path that turns a set of window trades into
 * TokenMetrics + ScoreResult by calling the Phase-2 pure engines. Both the demo
 * pipeline (in-memory ring buffers) and the REST layer (DB queries) call
 * `computeTokenView`, so metrics/scores are identical regardless of source.
 */

import { TIME_WINDOW_MS, type TimeWindow } from '@chainscope/config';
import {
  computeTokenMetrics,
  computeOpportunityScore,
  generateExplanations,
  type MetricTrade,
  type TokenMetrics,
  type ScoreResult,
  type Explanations,
  type WalletClass,
} from '@chainscope/shared';

export interface TokenMeta {
  readonly priceUsd: number | null;
  readonly priceConfidence: number;
  readonly liquidityUsd: number | null;
  /** Signed 24h liquidity change fraction (negative = removal). */
  readonly liquidityChangePct: number;
  readonly contractVerified: boolean;
  /** Comparable baseline USD volume for volume-acceleration. */
  readonly baselineVolumeUsd?: number;
}

export interface TokenView {
  readonly window: TimeWindow;
  readonly metrics: TokenMetrics;
  readonly score: ScoreResult;
}

export interface RawMetricTrade {
  readonly side: 'BUY' | 'SELL';
  readonly valueUsd: number | null;
  readonly priceConfidence: number;
  readonly walletClass: WalletClass;
  readonly traderAddress: string;
  /** epoch ms */
  readonly timestamp: number;
}

export function toMetricTrade(t: RawMetricTrade): MetricTrade {
  return {
    side: t.side,
    valueUsd: t.valueUsd,
    priceConfidence: t.priceConfidence,
    walletClass: t.walletClass,
    traderAddress: t.traderAddress,
    timestamp: t.timestamp,
  };
}

function buySellImbalance(m: TokenMetrics): number {
  const total = m.buyVolumeUsd + m.sellVolumeUsd;
  return total > 0 ? (m.buyVolumeUsd - m.sellVolumeUsd) / total : 0;
}

/**
 * Compute metrics + score for one token over one window.
 *
 * @param currentTrades trades within [now - windowMs, now]
 * @param priorTrades   trades within [now - 2*windowMs, now - windowMs] — used
 *                      only for prior-window growth references. Pass [] if none.
 */
export function computeTokenView(params: {
  window: TimeWindow;
  now: number;
  currentTrades: readonly MetricTrade[];
  priorTrades: readonly MetricTrade[];
  meta: TokenMeta;
}): TokenView {
  const { window, now, currentTrades, priorTrades, meta } = params;
  const windowMs = TIME_WINDOW_MS[window];

  const priorMetrics = computeTokenMetrics({
    window,
    windowStartMs: now - 2 * windowMs,
    windowEndMs: now - windowMs,
    trades: priorTrades,
    currentPriceUsd: meta.priceUsd,
    currentLiquidityUsd: meta.liquidityUsd,
  });

  const metrics = computeTokenMetrics({
    window,
    windowStartMs: now - windowMs,
    windowEndMs: now,
    trades: currentTrades,
    currentPriceUsd: meta.priceUsd,
    currentLiquidityUsd: meta.liquidityUsd,
    prior: {
      uniqueBuyers: priorMetrics.uniqueBuyers,
      walletQualityScore: priorMetrics.walletQualityScore,
      priceUsd: meta.priceUsd,
      liquidityUsd: meta.liquidityUsd,
    },
    ...(meta.baselineVolumeUsd !== undefined ? { baselineVolumeUsd: meta.baselineVolumeUsd } : {}),
  });

  const score = computeOpportunityScore({
    components: {
      smartMoneyNetFlowUsd: metrics.smartMoneyNetFlowUsd,
      whaleNetFlowUsd: metrics.whaleNetFlowUsd,
      uniqueBuyerGrowth: metrics.uniqueBuyerGrowth ?? 0,
      buySellImbalance: buySellImbalance(metrics),
      liquidityGrowthPct: metrics.liquidityChangePct ?? meta.liquidityChangePct,
      buyerQualityImprovement: metrics.buyerQualityImprovement ?? 0,
      volumeAcceleration: metrics.volumeAcceleration ?? 0,
      priceConfirmation: metrics.priceChangePct ?? 0,
    },
    risk: {
      deployerLinkedNetFlowUsd: metrics.deployerLinkedNetFlowUsd,
      liquidityChangePct: meta.liquidityChangePct,
      buyerConcentration: metrics.buyerConcentration,
      sellerConcentration: metrics.sellerConcentration,
      liquidityUsd: meta.liquidityUsd,
      contractVerified: meta.contractVerified,
      priceConfidence: meta.priceConfidence,
      dataConfidenceScore: metrics.dataConfidenceScore,
    },
  });

  return { window, metrics, score };
}

export function explainTokenView(
  view: TokenView,
  meta: TokenMeta,
  counts?: { smartMoneyBuyers?: number; whaleBuyers?: number; deployerSellers?: number },
): Explanations {
  return generateExplanations({
    metrics: view.metrics,
    score: view.score,
    window: view.window,
    ...(counts ? { counts } : {}),
    liquidityUsd: meta.liquidityUsd,
    priceConfidence: meta.priceConfidence,
  });
}
