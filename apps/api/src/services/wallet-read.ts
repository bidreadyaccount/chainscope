/**
 * Read model for wallet endpoints (SPEC §14F). Assembles a WalletActivitySummary
 * from persisted history and runs the Phase-2 classification / smart-money / bot
 * engines to surface hedged labels, confidences, reasons, P&L, win rate and bot
 * probability. Relationships/positions are read from the DB.
 */

import { ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import {
  classifyWallet,
  scoreBotProbability,
  scoreSmartMoney,
  fromRawAmount,
  serializeForWire,
  type WalletActivitySummary,
  type WalletTimingStats,
  type SmartMoneyInput,
} from '@chainscope/shared';
import type { PrismaClient } from '@chainscope/database';
import type { TokenMetaProvider } from './token-meta.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface WalletRow {
  id: string;
  address: string;
  firstSeenAt: Date | null;
  lifetimeTxCount: number;
  portfolioValueUsd: number | null;
  fundingSourceAddress: string | null;
}

export class WalletReadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly meta: TokenMetaProvider,
    private readonly clock: () => number = Date.now,
  ) {}

  private async walletRow(address: string): Promise<WalletRow | null> {
    return (await this.prisma.wallet.findUnique({
      where: { chainId_address: { chainId: ROBINHOOD_CHAIN_ID, address } },
      select: {
        id: true,
        address: true,
        firstSeenAt: true,
        lifetimeTxCount: true,
        portfolioValueUsd: true,
        fundingSourceAddress: true,
      },
    })) as WalletRow | null;
  }

  private timingFromTrades(
    trades: Array<{ tokenAmount: string; blockTimestamp: Date }>,
  ): WalletTimingStats {
    // Repeated identical trade sizes (bot indicator).
    let maxRun = 0;
    let run = 0;
    let prev: string | null = null;
    for (const t of trades) {
      if (t.tokenAmount === prev) run += 1;
      else run = 1;
      prev = t.tokenAmount;
      if (run > maxRun) maxRun = run;
    }
    // Peak trades per hour.
    const buckets = new Map<number, number>();
    for (const t of trades) {
      const hour = Math.floor(t.blockTimestamp.getTime() / (60 * 60 * 1000));
      buckets.set(hour, (buckets.get(hour) ?? 0) + 1);
    }
    const peak = buckets.size > 0 ? Math.max(...buckets.values()) : 0;
    return { identicalAmountRepeats: maxRun, txPerHourPeak: peak };
  }

  async exists(address: string): Promise<boolean> {
    return (await this.walletRow(address)) !== null;
  }

  async detail(address: string): Promise<Record<string, unknown> | null> {
    const wallet = await this.walletRow(address);
    if (!wallet) return null;
    const now = this.clock();

    const [trades, positions, relationships, fundingPeers] = await Promise.all([
      this.prisma.trade.findMany({
        where: { chainId: ROBINHOOD_CHAIN_ID, walletId: wallet.id },
        select: { valueUsd: true, side: true, tokenAmount: true, blockTimestamp: true },
        orderBy: { blockTimestamp: 'asc' },
      }),
      this.prisma.walletTokenPosition.findMany({
        where: { walletId: wallet.id },
        include: { token: { select: { address: true, symbol: true, decimals: true } } },
      }),
      this.prisma.walletRelationship.findMany({
        where: { OR: [{ sourceWalletId: wallet.id }, { targetWalletId: wallet.id }] },
      }),
      wallet.fundingSourceAddress
        ? this.prisma.wallet.count({
            where: {
              chainId: ROBINHOOD_CHAIN_ID,
              fundingSourceAddress: wallet.fundingSourceAddress,
            },
          })
        : Promise.resolve(0),
    ]);

    const sizes = trades.filter((t) => t.valueUsd !== null).map((t) => t.valueUsd as number);
    const investedUsd = trades
      .filter((t) => t.side === 'BUY' && t.valueUsd !== null)
      .reduce((a, t) => a + (t.valueUsd as number), 0);

    const realizedPnlUsd = positions.reduce((a, p) => a + p.realizedPnlUsd, 0);
    const unrealizedPnlUsd = positions.reduce((a, p) => a + p.unrealizedPnlUsd, 0);
    const winningPositions = positions.reduce((a, p) => a + p.winningClosed, 0);
    const losingPositions = positions.reduce((a, p) => a + p.losingClosed, 0);
    const closedPositions = winningPositions + losingPositions;
    const winRate = closedPositions > 0 ? winningPositions / closedPositions : null;

    const currentValueUsd = positions.reduce((a, p) => {
      const price = this.meta.token(p.token.address)?.priceUsd ?? null;
      if (price === null) return a;
      return a + fromRawAmount(p.currentQtyRaw, p.token.decimals) * price;
    }, 0);

    const firstSeenDaysAgo = wallet.firstSeenAt
      ? Math.max(0, (now - wallet.firstSeenAt.getTime()) / DAY_MS)
      : 0;

    const smartMoney: SmartMoneyInput = {
      realizedProfitUsd: realizedPnlUsd,
      investedUsd,
      closedPositions,
      winningPositions,
      losingPositions,
    };

    const deployerRels = relationships.filter((r) => /DEPLOYER/i.test(r.relationType));
    const summary: WalletActivitySummary = {
      address: wallet.address,
      portfolioValueUsd: wallet.portfolioValueUsd ?? currentValueUsd,
      tradeSizesUsd: sizes,
      firstSeenDaysAgo,
      txCount: wallet.lifetimeTxCount || trades.length,
      timing: this.timingFromTrades(trades),
      smartMoney,
      ...(deployerRels.length > 0 ? { isFundedByDeployer: true } : {}),
      ...(fundingPeers > 1 ? { fundingSourceSharedCount: fundingPeers } : {}),
    };

    const classification = classifyWallet(summary, now);
    const botScore = scoreBotProbability(summary);
    const smartScore = scoreSmartMoney(smartMoney);

    return {
      address: wallet.address,
      primaryClass: classification.primary,
      classificationConfidence: classification.confidence,
      labels: classification.labels,
      portfolioEstimateUsd: wallet.portfolioValueUsd ?? currentValueUsd,
      trackedCurrentValueUsd: currentValueUsd,
      realizedPnlUsd,
      unrealizedPnlUsd,
      totalPnlUsd: realizedPnlUsd + unrealizedPnlUsd,
      winRate,
      closedPositions,
      winningPositions,
      losingPositions,
      avgTradeSizeUsd: sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : null,
      tradeCount: trades.length,
      firstSeenAt: wallet.firstSeenAt ? wallet.firstSeenAt.toISOString() : null,
      botProbability: botScore.probability,
      botIndicators: botScore.indicators,
      smartMoney: {
        score: smartScore.score,
        status: smartScore.status,
        sampleSizeMet: smartScore.sampleSizeMet,
        winRate: smartScore.winRate,
      },
      deployerRelationships: deployerRels.map((r) => serializeForWire(r)),
      fundingSourceAddress: wallet.fundingSourceAddress,
      fundingSourcePeerCount: fundingPeers,
      explorer: { address: `https://robinhoodchain.blockscout.com/address/${wallet.address}` },
    };
  }

  async positions(address: string): Promise<{ items: unknown[] } | null> {
    const wallet = await this.walletRow(address);
    if (!wallet) return null;
    const positions = await this.prisma.walletTokenPosition.findMany({
      where: { walletId: wallet.id },
      include: { token: { select: { address: true, symbol: true, decimals: true } } },
    });
    const items = positions.map((p) => {
      const price = this.meta.token(p.token.address)?.priceUsd ?? null;
      const qty = fromRawAmount(p.currentQtyRaw, p.token.decimals);
      return {
        tokenAddress: p.token.address,
        tokenSymbol: p.token.symbol,
        currentQty: qty,
        currentValueUsd: price !== null ? qty * price : null,
        avgEntryCostUsd: p.avgEntryCostUsd,
        realizedPnlUsd: p.realizedPnlUsd,
        unrealizedPnlUsd: p.unrealizedPnlUsd,
        totalReturnUsd: p.totalReturnUsd,
        winningClosed: p.winningClosed,
        losingClosed: p.losingClosed,
        isComplete: p.isComplete,
        firstEntryAt: p.firstEntryAt ? p.firstEntryAt.toISOString() : null,
        lastTradeAt: p.lastTradeAt ? p.lastTradeAt.toISOString() : null,
      };
    });
    return { items };
  }

  async relationships(address: string): Promise<Record<string, unknown> | null> {
    const wallet = await this.walletRow(address);
    if (!wallet) return null;
    const rels = await this.prisma.walletRelationship.findMany({
      where: { OR: [{ sourceWalletId: wallet.id }, { targetWalletId: wallet.id }] },
    });
    let fundingPeers: string[] = [];
    if (wallet.fundingSourceAddress) {
      const peers = await this.prisma.wallet.findMany({
        where: {
          chainId: ROBINHOOD_CHAIN_ID,
          fundingSourceAddress: wallet.fundingSourceAddress,
          NOT: { id: wallet.id },
        },
        select: { address: true },
        take: 50,
      });
      fundingPeers = peers.map((p) => p.address);
    }
    return {
      address: wallet.address,
      fundingSourceAddress: wallet.fundingSourceAddress,
      sharedFundingPeers: fundingPeers,
      relationships: rels.map((r) => serializeForWire(r)),
      note:
        rels.length === 0 && fundingPeers.length === 0
          ? 'No related-wallet clusters recorded for this wallet (relationship inference is populated as evidence accrues).'
          : undefined,
    };
  }
}
