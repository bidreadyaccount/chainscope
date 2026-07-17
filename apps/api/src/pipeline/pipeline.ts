/**
 * Ingest pipeline — the heart of both demo and live mode.
 *
 * A single `ingest(trade)` interface runs every emitted/decoded trade through
 * the identical path: persist Trade → update WalletTokenPosition via the
 * Phase-2 cost-basis engine → recompute the token's rolling metrics for all six
 * windows from an in-memory ring buffer → recompute opportunity/risk score with
 * full breakdown → update Redis sorted-set rankings for all 12 categories →
 * (throttled) persist TokenMetricSnapshot/TokenScoreSnapshot → publish
 * trade/token_metrics/score envelopes to Redis pub/sub for WS fanout.
 *
 * Phase 4's indexer reuses this class unchanged: it calls `ingest(normalizedTrade)`
 * for each decoded swap. Metrics are computed from an in-memory 24h ring buffer
 * per token (query-free on the hot path); the REST layer computes the same
 * metrics from Postgres queries via the shared analytics service.
 */

import { TIME_WINDOWS, TIME_WINDOW_MS, type TimeWindow } from '@chainscope/config';
import {
  computePosition,
  serializeForWire,
  type NormalizedTrade,
  type MetricTrade,
  type PnlTradeEvent,
  type SerializedTrade,
} from '@chainscope/shared';
import type { PrismaClient } from '@chainscope/database';
import type { FastifyBaseLogger } from 'fastify';
import { ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import { computeTokenView, type TokenView } from '../services/analytics.js';
import type { RankingsService } from '../services/rankings.js';
import type { PubSub } from '../services/pubsub.js';
import type { TokenMetaProvider } from '../services/token-meta.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PUBLISH_WINDOW: TimeWindow = '1h';

export interface IngestOptions {
  readonly persistTrade?: boolean;
  readonly persistPosition?: boolean;
  readonly recompute?: boolean;
  readonly publish?: boolean;
  readonly persistSnapshot?: boolean;
  readonly forceSnapshot?: boolean;
}

interface PairState {
  readonly walletId: string;
  readonly tokenId: string;
  readonly tokenAddress: string;
  readonly decimals: number;
  readonly currentPriceUsd: number | null;
  readonly events: PnlTradeEvent[];
}

export interface PipelineDeps {
  readonly prisma: PrismaClient;
  readonly rankings: RankingsService;
  readonly pubsub: PubSub;
  readonly meta: TokenMetaProvider;
  readonly logger: FastifyBaseLogger;
  readonly snapshotIntervalMs?: number;
  readonly clock?: () => number;
}

export class Pipeline {
  private readonly prisma: PrismaClient;
  private readonly rankings: RankingsService;
  private readonly pubsub: PubSub;
  private readonly meta: TokenMetaProvider;
  private readonly logger: FastifyBaseLogger;
  private readonly snapshotIntervalMs: number;
  private readonly clock: () => number;

  private readonly tokenBuffers = new Map<string, MetricTrade[]>();
  private readonly pairs = new Map<string, PairState>();
  private readonly tokenIdByAddress = new Map<string, string>();
  private readonly decimalsByAddress = new Map<string, number>();
  private readonly walletIdByAddress = new Map<string, string>();
  private readonly lastSnapshotAt = new Map<string, number>();
  private initialized = false;

  constructor(deps: PipelineDeps) {
    this.prisma = deps.prisma;
    this.rankings = deps.rankings;
    this.pubsub = deps.pubsub;
    this.meta = deps.meta;
    this.logger = deps.logger;
    this.snapshotIntervalMs = deps.snapshotIntervalMs ?? 10_000;
    this.clock = deps.clock ?? Date.now;
  }

  /** Load token/wallet id + decimals caches from the DB. */
  async init(): Promise<void> {
    if (this.initialized) return;
    const [tokens, wallets] = await Promise.all([
      this.prisma.token.findMany({ select: { id: true, address: true, decimals: true } }),
      this.prisma.wallet.findMany({ select: { id: true, address: true } }),
    ]);
    for (const t of tokens) {
      const key = t.address.toLowerCase();
      this.tokenIdByAddress.set(key, t.id);
      this.decimalsByAddress.set(key, t.decimals);
    }
    for (const w of wallets) this.walletIdByAddress.set(w.address.toLowerCase(), w.id);
    this.initialized = true;
  }

  /**
   * Warm in-memory state from the last 24h of persisted trades, then compute a
   * first snapshot + rankings for every token. Positions are persisted so the
   * holders endpoint has data. Trades are NOT re-persisted (already seeded) and
   * nothing is published.
   */
  async warmup(): Promise<{ trades: number; tokens: number; positions: number }> {
    await this.init();
    const since = new Date(this.clock() - DAY_MS);
    const rows = await this.prisma.trade.findMany({
      where: { blockTimestamp: { gte: since } },
      orderBy: { blockTimestamp: 'asc' },
    });
    for (const row of rows) {
      await this.ingest(this.rowToNormalized(row), {
        persistTrade: false,
        persistPosition: false,
        recompute: false,
        publish: false,
        persistSnapshot: false,
      });
    }
    const positions = await this.persistAllPositions();
    let tokenCount = 0;
    for (const [addrLower, tokenId] of this.tokenIdByAddress) {
      const address = this.originalAddress(addrLower);
      await this.recomputeToken(address, tokenId, {
        publish: false,
        persistSnapshot: true,
        forceSnapshot: true,
      });
      tokenCount++;
    }
    return { trades: rows.length, tokens: tokenCount, positions };
  }

  /**
   * The reusable ingest interface (Phase 4 shares this). Deterministic given
   * seed + DB state (timestamps aside).
   */
  async ingest(trade: NormalizedTrade, options: IngestOptions = {}): Promise<void> {
    const {
      persistTrade = true,
      persistPosition = true,
      recompute = true,
      publish = true,
      persistSnapshot = true,
      forceSnapshot = false,
    } = options;

    const addrLower = trade.tokenAddress.toLowerCase();
    const tokenId = this.tokenIdByAddress.get(addrLower);
    if (!tokenId) {
      this.logger.warn({ token: trade.tokenAddress }, 'ingest: unknown token, skipping');
      return;
    }
    const walletId = await this.resolveWalletId(trade.traderAddress);

    if (persistTrade) await this.persistTrade(trade, tokenId, walletId);

    // Position event state (always tracked so live P&L reflects full history).
    const pair = this.appendEvent(trade, tokenId, walletId, addrLower);
    if (persistPosition) await this.persistPosition(pair);

    // Metric ring-buffer.
    this.appendMetricTrade(addrLower, trade);

    if (publish) {
      await this.pubsub.publish('trade', this.toSerializedTrade(trade), trade.blockTimestamp);
    }

    if (recompute) {
      await this.recomputeToken(trade.tokenAddress, tokenId, {
        publish,
        persistSnapshot,
        forceSnapshot,
      });
    }
  }

  // --- recompute + rankings + snapshots -------------------------------------

  private async recomputeToken(
    address: string,
    tokenId: string,
    opts: { publish: boolean; persistSnapshot: boolean; forceSnapshot: boolean },
  ): Promise<void> {
    const addrLower = address.toLowerCase();
    const buffer = this.tokenBuffers.get(addrLower) ?? [];
    const meta = this.meta.meta(address) ?? {
      priceUsd: null,
      priceConfidence: 0,
      liquidityUsd: null,
      liquidityChangePct: 0,
      contractVerified: true,
    };
    const now = this.clock();

    const views: Partial<Record<TimeWindow, TokenView>> = {};
    for (const window of TIME_WINDOWS) {
      const windowMs = TIME_WINDOW_MS[window];
      const current = buffer.filter((t) => t.timestamp > now - windowMs && t.timestamp <= now);
      const prior = buffer.filter(
        (t) => t.timestamp > now - 2 * windowMs && t.timestamp <= now - windowMs,
      );
      views[window] = computeTokenView({ window, now, currentTrades: current, priorTrades: prior, meta });
    }

    await this.rankings.updateToken(address, views);

    if (opts.publish) {
      const primary = views[DEFAULT_PUBLISH_WINDOW];
      if (primary) {
        await this.pubsub.publish('token_metrics', {
          tokenAddress: address,
          window: DEFAULT_PUBLISH_WINDOW,
          metrics: primary.metrics,
        });
        await this.pubsub.publish('score', {
          tokenAddress: address,
          window: DEFAULT_PUBLISH_WINDOW,
          score: primary.score.score,
          riskScore: primary.score.riskScore,
          signal: primary.score.signal,
          components: primary.score.components,
          penalties: primary.score.penalties,
        });
      }
    }

    if (opts.persistSnapshot && (opts.forceSnapshot || this.snapshotDue(tokenId, now))) {
      await this.persistSnapshots(tokenId, now, views);
      this.lastSnapshotAt.set(tokenId, now);
    }
  }

  private snapshotDue(tokenId: string, now: number): boolean {
    const last = this.lastSnapshotAt.get(tokenId);
    return last === undefined || now - last >= this.snapshotIntervalMs;
  }

  private async persistSnapshots(
    tokenId: string,
    now: number,
    views: Partial<Record<TimeWindow, TokenView>>,
  ): Promise<void> {
    const capturedAt = new Date(now);
    const metricRows = [];
    const scoreRows = [];
    for (const window of TIME_WINDOWS) {
      const view = views[window];
      if (!view) continue;
      const m = view.metrics;
      metricRows.push({
        tokenId,
        window,
        capturedAt,
        buyVolumeUsd: m.buyVolumeUsd,
        sellVolumeUsd: m.sellVolumeUsd,
        netFlowUsd: m.netFlowUsd,
        buyCount: m.buys,
        sellCount: m.sells,
        uniqueBuyers: m.uniqueBuyers,
        uniqueSellers: m.uniqueSellers,
        buySellRatio: m.buySellRatio,
        whaleNetFlowUsd: m.whaleNetFlowUsd,
        smartMoneyNetFlowUsd: m.smartMoneyNetFlowUsd,
        retailNetFlowUsd: m.retailNetFlowUsd,
        newWalletNetFlowUsd: m.newWalletNetFlowUsd,
        botVolumeUsd: m.botAssociatedVolumeUsd,
        deployerNetFlowUsd: m.deployerLinkedNetFlowUsd,
        avgTradeSizeUsd: m.avgTradeSizeUsd,
        medianTradeSizeUsd: m.medianTradeSizeUsd,
        priceChangePct: m.priceChangePct,
        volumeAcceleration: m.volumeAcceleration,
        liquidityChangePct: m.liquidityChangePct,
        holderGrowth: m.holderGrowth,
        buyerConcentration: m.buyerConcentration,
        sellerConcentration: m.sellerConcentration,
        walletQualityScore: m.walletQualityScore,
        dataConfidence: m.dataConfidenceScore,
      });
      scoreRows.push({
        tokenId,
        window,
        capturedAt,
        opportunityScore: view.score.score,
        riskScore: view.score.riskScore,
        signalLabel: view.score.signal,
        breakdown: serializeForWire({
          components: view.score.components,
          penalties: view.score.penalties,
          baseScore: view.score.baseScore,
          totalPenalty: view.score.totalPenalty,
        }) as object,
      });
    }
    await Promise.all([
      this.prisma.tokenMetricSnapshot.createMany({ data: metricRows, skipDuplicates: true }),
      this.prisma.tokenScoreSnapshot.createMany({ data: scoreRows, skipDuplicates: true }),
    ]);
  }

  // --- persistence helpers --------------------------------------------------

  private async persistTrade(trade: NormalizedTrade, tokenId: string, walletId: string): Promise<void> {
    const data = {
      id: trade.id,
      chainId: trade.chainId,
      transactionHash: trade.transactionHash,
      logIndex: trade.logIndex,
      blockNumber: trade.blockNumber,
      blockTimestamp: trade.blockTimestamp,
      dexName: trade.dexName,
      routerAddress: trade.routerAddress ?? null,
      poolAddress: trade.poolAddress,
      traderAddress: trade.traderAddress,
      tokenId,
      tokenAddress: trade.tokenAddress,
      tokenSymbol: trade.tokenSymbol,
      quoteTokenAddress: trade.quoteTokenAddress,
      quoteTokenSymbol: trade.quoteTokenSymbol,
      side: trade.side,
      tokenAmount: trade.tokenAmount,
      quoteAmount: trade.quoteAmount,
      priceUsd: trade.priceUsd,
      valueUsd: trade.valueUsd,
      priceConfidence: trade.priceConfidence,
      walletClass: trade.walletClass,
      walletClassificationConfidence: trade.walletClassificationConfidence,
      walletId,
      isDemo: trade.isDemo,
    };
    // Idempotent on (chainId, transactionHash, logIndex) — duplicate-event protection.
    await this.prisma.trade.upsert({
      where: {
        chainId_transactionHash_logIndex: {
          chainId: trade.chainId,
          transactionHash: trade.transactionHash,
          logIndex: trade.logIndex,
        },
      },
      create: data,
      update: {},
    });
  }

  private appendEvent(
    trade: NormalizedTrade,
    tokenId: string,
    walletId: string,
    addrLower: string,
  ): PairState {
    const key = `${walletId}|${tokenId}`;
    let pair = this.pairs.get(key);
    if (!pair) {
      pair = {
        walletId,
        tokenId,
        tokenAddress: trade.tokenAddress,
        decimals: this.decimalsByAddress.get(addrLower) ?? 18,
        currentPriceUsd: trade.priceUsd,
        events: [],
      };
      this.pairs.set(key, pair);
    }
    pair.events.push({
      side: trade.side,
      kind: 'SWAP',
      tokenAmountRaw: trade.tokenAmount,
      quoteValueUsd: trade.valueUsd,
      timestamp: trade.blockTimestamp.getTime(),
    });
    return pair;
  }

  private async persistPosition(pair: PairState): Promise<void> {
    const price = this.meta.token(pair.tokenAddress)?.priceUsd ?? pair.currentPriceUsd;
    const pos = computePosition({
      decimals: pair.decimals,
      currentPriceUsd: price,
      events: pair.events,
    });
    const data = {
      totalPurchasedRaw: pos.totalBoughtRaw.toString(),
      totalSoldRaw: pos.totalSoldRaw.toString(),
      currentQtyRaw: pos.currentQtyRaw.toString(),
      avgEntryCostUsd: pos.avgEntryCostUsd,
      realizedPnlUsd: pos.realizedPnlUsd,
      unrealizedPnlUsd: pos.unrealizedPnlUsd ?? 0,
      totalReturnUsd: pos.totalReturnUsd ?? 0,
      firstEntryAt: pos.firstEntryAt ? new Date(pos.firstEntryAt) : null,
      lastTradeAt: pos.lastTradeAt ? new Date(pos.lastTradeAt) : null,
      avgHoldingPeriodSec: pos.avgHoldingPeriodSeconds,
      winningClosed: pos.winningClosed,
      losingClosed: pos.losingClosed,
      isComplete: !pos.incomplete,
    };
    await this.prisma.walletTokenPosition.upsert({
      where: { walletId_tokenId: { walletId: pair.walletId, tokenId: pair.tokenId } },
      create: { walletId: pair.walletId, tokenId: pair.tokenId, ...data },
      update: data,
    });
  }

  private async persistAllPositions(): Promise<number> {
    let count = 0;
    for (const pair of this.pairs.values()) {
      await this.persistPosition(pair);
      count++;
    }
    return count;
  }

  private async resolveWalletId(address: string): Promise<string> {
    const key = address.toLowerCase();
    const cached = this.walletIdByAddress.get(key);
    if (cached) return cached;
    const wallet = await this.prisma.wallet.upsert({
      where: { chainId_address: { chainId: ROBINHOOD_CHAIN_ID, address } },
      create: { chainId: ROBINHOOD_CHAIN_ID, address, isDemo: true },
      update: {},
      select: { id: true },
    });
    this.walletIdByAddress.set(key, wallet.id);
    return wallet.id;
  }

  // --- small helpers --------------------------------------------------------

  private appendMetricTrade(addrLower: string, trade: NormalizedTrade): void {
    let buffer = this.tokenBuffers.get(addrLower);
    if (!buffer) {
      buffer = [];
      this.tokenBuffers.set(addrLower, buffer);
    }
    buffer.push({
      side: trade.side,
      valueUsd: trade.valueUsd,
      priceConfidence: trade.priceConfidence,
      walletClass: trade.walletClass,
      traderAddress: trade.traderAddress,
      timestamp: trade.blockTimestamp.getTime(),
    });
    const cutoff = this.clock() - DAY_MS;
    if (buffer.length > 0 && buffer[0]!.timestamp < cutoff) {
      this.tokenBuffers.set(
        addrLower,
        buffer.filter((t) => t.timestamp >= cutoff),
      );
    }
  }

  private originalAddress(addrLower: string): string {
    return this.meta.token(addrLower)?.address ?? addrLower;
  }

  private toSerializedTrade(trade: NormalizedTrade): SerializedTrade {
    return serializeForWire(trade) as unknown as SerializedTrade;
  }

  private rowToNormalized(row: {
    id: string;
    chainId: number;
    transactionHash: string;
    logIndex: number;
    blockNumber: bigint;
    blockTimestamp: Date;
    dexName: string;
    routerAddress: string | null;
    poolAddress: string;
    traderAddress: string;
    tokenAddress: string;
    tokenSymbol: string;
    quoteTokenAddress: string;
    quoteTokenSymbol: string;
    side: 'BUY' | 'SELL';
    tokenAmount: string;
    quoteAmount: string;
    priceUsd: number | null;
    valueUsd: number | null;
    priceConfidence: number;
    walletClass: NormalizedTrade['walletClass'];
    walletClassificationConfidence: number;
    isDemo: boolean;
  }): NormalizedTrade {
    return {
      id: row.id,
      chainId: row.chainId as 4663,
      transactionHash: row.transactionHash as `0x${string}`,
      logIndex: row.logIndex,
      blockNumber: row.blockNumber,
      blockTimestamp: row.blockTimestamp,
      dexName: row.dexName,
      ...(row.routerAddress ? { routerAddress: row.routerAddress as `0x${string}` } : {}),
      poolAddress: row.poolAddress as `0x${string}`,
      traderAddress: row.traderAddress as `0x${string}`,
      tokenAddress: row.tokenAddress as `0x${string}`,
      tokenSymbol: row.tokenSymbol,
      quoteTokenAddress: row.quoteTokenAddress as `0x${string}`,
      quoteTokenSymbol: row.quoteTokenSymbol,
      side: row.side,
      tokenAmount: row.tokenAmount,
      quoteAmount: row.quoteAmount,
      priceUsd: row.priceUsd,
      valueUsd: row.valueUsd,
      priceConfidence: row.priceConfidence,
      walletClass: row.walletClass,
      walletClassificationConfidence: row.walletClassificationConfidence,
      isDemo: row.isDemo,
    };
  }
}
