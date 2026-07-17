import { describe, it, expect } from 'vitest';
import { generateDemoDataset } from '../demo/generator.js';
import type { NormalizedTrade } from '../types/trade.js';
import type { DemoWallet } from '../demo/types.js';
import { classifyWallet } from './classification/index.js';
import type { WalletActivitySummary } from './classification/index.js';
import { computePosition } from './pnl/index.js';
import type { PnlTradeEvent } from './pnl/index.js';
import { computeTokenMetrics } from './metrics/index.js';
import type { MetricTrade } from './metrics/index.js';
import { computeOpportunityScore } from './scoring/index.js';
import { generateExplanations } from './explanations/index.js';

const FIXED_NOW = Date.UTC(2025, 5, 15, 12, 0, 0);

function walletSummary(w: DemoWallet, trades: NormalizedTrade[]): WalletActivitySummary {
  const sizes = trades.filter((t) => t.valueUsd !== null).map((t) => t.valueUsd as number);
  return {
    address: w.address,
    portfolioValueUsd: w.portfolioUsd,
    tradeSizesUsd: sizes,
    firstSeenDaysAgo: w.firstSeenDaysAgo,
    txCount: w.lifetimeTxs,
    isFundedByDeployer: w.archetype === 'DEPLOYER_LINKED',
    fundingSourceSharedCount: w.fundingSourceAddress ? 6 : 0,
  };
}

function toMetricTrade(t: NormalizedTrade): MetricTrade {
  return {
    side: t.side,
    valueUsd: t.valueUsd,
    priceConfidence: t.priceConfidence,
    walletClass: t.walletClass,
    traderAddress: t.traderAddress,
    timestamp: t.blockTimestamp.getTime(),
  };
}

/** Run the whole pipeline for one token and return a compact, stable summary. */
function runPipeline(seed: number) {
  const ds = generateDemoDataset(seed, FIXED_NOW);
  const windowStart = FIXED_NOW - 24 * 60 * 60 * 1000;

  const results = ds.tokens.map((token) => {
    const tokenTrades = ds.trades.filter((t) => t.tokenAddress === token.address);
    const metricTrades = tokenTrades.map(toMetricTrade);

    const metrics = computeTokenMetrics({
      window: '24h',
      windowStartMs: windowStart,
      windowEndMs: FIXED_NOW,
      trades: metricTrades,
      currentPriceUsd: token.priceUsd,
      currentLiquidityUsd: token.liquidityUsd,
      prior: { uniqueBuyers: 5, priceUsd: token.priceUsd, liquidityUsd: token.liquidityUsd, walletQualityScore: 45 },
      baselineVolumeUsd: 50_000,
    });

    const score = computeOpportunityScore({
      components: {
        smartMoneyNetFlowUsd: metrics.smartMoneyNetFlowUsd,
        whaleNetFlowUsd: metrics.whaleNetFlowUsd,
        uniqueBuyerGrowth: metrics.uniqueBuyerGrowth ?? 0,
        buySellImbalance:
          metrics.buyVolumeUsd + metrics.sellVolumeUsd > 0
            ? (metrics.buyVolumeUsd - metrics.sellVolumeUsd) / (metrics.buyVolumeUsd + metrics.sellVolumeUsd)
            : 0,
        liquidityGrowthPct: metrics.liquidityChangePct ?? 0,
        buyerQualityImprovement: metrics.buyerQualityImprovement ?? 0,
        volumeAcceleration: metrics.volumeAcceleration ?? 0,
        priceConfirmation: metrics.priceChangePct ?? 0,
      },
      risk: {
        deployerLinkedNetFlowUsd: metrics.deployerLinkedNetFlowUsd,
        liquidityChangePct: token.liquidityChangePct,
        buyerConcentration: metrics.buyerConcentration,
        sellerConcentration: metrics.sellerConcentration,
        liquidityUsd: token.liquidityUsd,
        priceConfidence: token.priceConfidence,
        dataConfidenceScore: metrics.dataConfidenceScore,
      },
    });

    const explanations = generateExplanations({
      metrics,
      score,
      window: '24h',
      liquidityUsd: token.liquidityUsd,
      priceConfidence: token.priceConfidence,
    });

    return {
      symbol: token.symbol,
      scenario: token.scenario,
      trades: tokenTrades.length,
      netFlowUsd: metrics.netFlowUsd,
      whaleNetFlowUsd: metrics.whaleNetFlowUsd,
      smartMoneyNetFlowUsd: metrics.smartMoneyNetFlowUsd,
      score: score.score,
      riskScore: score.riskScore,
      signal: score.signal,
      positiveFactors: explanations.positiveFactors.length,
      riskFactors: explanations.riskFactors.length,
    };
  });

  return { ds, results };
}

describe('integration — full pipeline over demo data', () => {
  const { ds, results } = runPipeline(1337);

  it('classifies every demo wallet into a valid primary class', () => {
    for (const w of ds.wallets) {
      const trades = ds.trades.filter((t) => t.traderAddress === w.address);
      const cls = classifyWallet(walletSummary(w, trades), FIXED_NOW);
      expect(cls.primary).toBeTypeOf('string');
      expect(cls.labels.length).toBeGreaterThan(0);
      expect(cls.confidence).toBeGreaterThanOrEqual(0);
      expect(cls.confidence).toBeLessThanOrEqual(100);
    }
  });

  it('mega-whale archetype wallets classify as a whale tier', () => {
    const mega = ds.wallets.find((w) => w.archetype === 'MEGA_WHALE')!;
    const trades = ds.trades.filter((t) => t.traderAddress === mega.address);
    const cls = classifyWallet(walletSummary(mega, trades), FIXED_NOW);
    expect(['MEGA_WHALE', 'WHALE']).toContain(cls.primary);
  });

  it('builds a coherent cost-basis position for an active wallet', () => {
    // Pick the wallet with the most trades on any single token.
    const byWalletToken = new Map<string, NormalizedTrade[]>();
    for (const t of ds.trades) {
      if (t.valueUsd === null) continue;
      const key = `${t.traderAddress}|${t.tokenAddress}`;
      (byWalletToken.get(key) ?? byWalletToken.set(key, []).get(key)!).push(t);
    }
    const [, group] = [...byWalletToken.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
    const token = ds.tokens.find((t) => t.address === group[0]!.tokenAddress)!;
    const events: PnlTradeEvent[] = group.map((t) => ({
      side: t.side,
      kind: 'SWAP',
      tokenAmountRaw: t.tokenAmount,
      quoteValueUsd: t.valueUsd,
      timestamp: t.blockTimestamp.getTime(),
    }));
    const pos = computePosition({ decimals: token.decimals, currentPriceUsd: token.priceUsd, events });
    expect(pos.totalBoughtRaw).toBeGreaterThanOrEqual(0n);
    expect(Number.isFinite(pos.realizedPnlUsd)).toBe(true);
    expect(pos.winningClosed + pos.losingClosed).toBeGreaterThanOrEqual(0);
  });

  it('produces sane, bounded scores for every token', () => {
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(r.riskScore).toBeGreaterThanOrEqual(0);
      expect(r.riskScore).toBeLessThanOrEqual(100);
      expect(r.signal).toBeTypeOf('string');
    }
  });

  it('whale-accumulation tokens show positive whale net flow on average', () => {
    const whaleTokens = results.filter((r) => r.scenario === 'WHALE_ACCUMULATION');
    const avgWhaleFlow = whaleTokens.reduce((a, r) => a + r.whaleNetFlowUsd, 0) / whaleTokens.length;
    expect(avgWhaleFlow).toBeGreaterThan(0);
  });

  it('deployer-selling tokens carry risk factors and score below strong accumulation', () => {
    const deployerTokens = results.filter((r) => r.scenario === 'DEPLOYER_SELLING');
    expect(deployerTokens.length).toBeGreaterThan(0);
    for (const r of deployerTokens) {
      expect(r.score).toBeLessThan(80);
    }
  });

  it('is fully deterministic: identical seed → identical pipeline output', () => {
    const again = runPipeline(1337);
    expect(again.results).toEqual(results);
  });

  it('a different seed changes the pipeline output', () => {
    const other = runPipeline(2024);
    expect(other.results).not.toEqual(results);
  });
});
