/**
 * Read model for token endpoints. Query-based (Postgres) analytics: loads the
 * window's trades and runs the same Phase-2 engines the pipeline uses via the
 * shared analytics service. Every numeric leaving here is JSON/BigInt-safe.
 */

import {
  TIME_WINDOW_MS,
  MIN_DISPLAYABLE_PRICE_CONFIDENCE,
  ROBINHOOD_CHAIN_ID,
  type TimeWindow,
} from '@chainscope/config';
import { fromRawAmount, serializeForWire, type WalletClass } from '@chainscope/shared';
import type { PrismaClient } from '@chainscope/database';
import { computeTokenView, explainTokenView, toMetricTrade, type RawMetricTrade } from './analytics.js';
import type { TokenMetaProvider } from './token-meta.js';

interface TokenRow {
  id: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isVerified: boolean;
  firstSeenAt: Date | null;
  circulatingSupply: string | null;
}

const TRADE_SELECT = {
  tokenAddress: true,
  side: true,
  valueUsd: true,
  priceConfidence: true,
  walletClass: true,
  traderAddress: true,
  blockTimestamp: true,
} as const;

export const TOKEN_SORT_KEYS = [
  'opportunityScore',
  'riskScore',
  'netFlowUsd',
  'whaleNetFlowUsd',
  'smartMoneyNetFlowUsd',
  'retailNetFlowUsd',
  'buyVolumeUsd',
  'sellVolumeUsd',
  'uniqueBuyers',
  'uniqueSellers',
  'liquidityUsd',
  'priceUsd',
  'volumeAcceleration',
] as const;
export type TokenSortKey = (typeof TOKEN_SORT_KEYS)[number];

export function isTokenSortKey(v: string): v is TokenSortKey {
  return (TOKEN_SORT_KEYS as readonly string[]).includes(v);
}

export interface TokenListItem {
  rank: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  ageDays: number | null;
  priceUsd: number | null;
  priceConfidence: number;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  netFlowUsd: number;
  uniqueBuyers: number;
  uniqueSellers: number;
  whaleNetFlowUsd: number;
  smartMoneyNetFlowUsd: number;
  retailNetFlowUsd: number;
  newWalletNetFlowUsd: number;
  deployerLinkedNetFlowUsd: number;
  volumeAcceleration: number | null;
  opportunityScore: number;
  riskScore: number;
  signal: string;
  dataConfidence: number;
}

export class TokenReadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly meta: TokenMetaProvider,
    private readonly clock: () => number = Date.now,
  ) {}

  private marketCap(row: TokenRow, priceUsd: number | null, priceConfidence: number): number | null {
    if (priceUsd === null || priceConfidence < MIN_DISPLAYABLE_PRICE_CONFIDENCE) return null;
    const supplyHuman = this.meta.token(row.address)?.circulatingSupply;
    const supply =
      supplyHuman ??
      (row.circulatingSupply ? fromRawAmount(row.circulatingSupply, row.decimals) : null);
    if (supply === null) return null;
    return priceUsd * supply;
  }

  private ageDays(row: TokenRow): number | null {
    const t = this.meta.token(row.address);
    if (t) return t.ageDays;
    if (row.firstSeenAt) return (this.clock() - row.firstSeenAt.getTime()) / (24 * 60 * 60 * 1000);
    return null;
  }

  /** Compute a token list item from its trades within the window. */
  private buildItem(row: TokenRow, window: TimeWindow, now: number, all: RawMetricTrade[]): TokenListItem {
    const windowMs = TIME_WINDOW_MS[window];
    const current = all.filter((t) => t.timestamp > now - windowMs && t.timestamp <= now).map(toMetricTrade);
    const prior = all
      .filter((t) => t.timestamp > now - 2 * windowMs && t.timestamp <= now - windowMs)
      .map(toMetricTrade);
    const meta = this.meta.meta(row.address) ?? {
      priceUsd: null,
      priceConfidence: 0,
      liquidityUsd: null,
      liquidityChangePct: 0,
      contractVerified: row.isVerified,
    };
    const view = computeTokenView({ window, now, currentTrades: current, priorTrades: prior, meta });
    const m = view.metrics;
    return {
      rank: 0,
      address: row.address,
      symbol: row.symbol,
      name: row.name,
      decimals: row.decimals,
      ageDays: this.ageDays(row),
      priceUsd: meta.priceUsd,
      priceConfidence: meta.priceConfidence,
      liquidityUsd: meta.liquidityUsd,
      marketCapUsd: this.marketCap(row, meta.priceUsd, meta.priceConfidence),
      buyVolumeUsd: m.buyVolumeUsd,
      sellVolumeUsd: m.sellVolumeUsd,
      netFlowUsd: m.netFlowUsd,
      uniqueBuyers: m.uniqueBuyers,
      uniqueSellers: m.uniqueSellers,
      whaleNetFlowUsd: m.whaleNetFlowUsd,
      smartMoneyNetFlowUsd: m.smartMoneyNetFlowUsd,
      retailNetFlowUsd: m.retailNetFlowUsd,
      newWalletNetFlowUsd: m.newWalletNetFlowUsd,
      deployerLinkedNetFlowUsd: m.deployerLinkedNetFlowUsd,
      volumeAcceleration: m.volumeAcceleration,
      opportunityScore: view.score.score,
      riskScore: view.score.riskScore,
      signal: view.score.signal,
      dataConfidence: m.dataConfidenceScore,
    };
  }

  async list(params: {
    window: TimeWindow;
    search?: string;
    walletClass?: WalletClass;
    sort: TokenSortKey;
    order: 'asc' | 'desc';
    limit: number;
    cursor?: string;
  }): Promise<{ window: TimeWindow; items: TokenListItem[]; nextCursor: string | null; total: number }> {
    const now = this.clock();
    const windowMs = TIME_WINDOW_MS[params.window];
    let tokens = (await this.prisma.token.findMany({
      where: { chainId: ROBINHOOD_CHAIN_ID },
      select: {
        id: true,
        address: true,
        symbol: true,
        name: true,
        decimals: true,
        isVerified: true,
        firstSeenAt: true,
        circulatingSupply: true,
      },
    })) as TokenRow[];

    if (params.search) {
      const q = params.search.toLowerCase();
      tokens = tokens.filter(
        (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
      );
    }

    const trades = (await this.prisma.trade.findMany({
      where: { chainId: ROBINHOOD_CHAIN_ID, blockTimestamp: { gte: new Date(now - 2 * windowMs) } },
      select: TRADE_SELECT,
    })) as unknown as Array<{
      tokenAddress: string;
      side: 'BUY' | 'SELL';
      valueUsd: number | null;
      priceConfidence: number;
      walletClass: WalletClass;
      traderAddress: string;
      blockTimestamp: Date;
    }>;

    const byToken = new Map<string, RawMetricTrade[]>();
    for (const t of trades) {
      const key = t.tokenAddress.toLowerCase();
      const arr = byToken.get(key) ?? [];
      arr.push({
        side: t.side,
        valueUsd: t.valueUsd,
        priceConfidence: t.priceConfidence,
        walletClass: t.walletClass,
        traderAddress: t.traderAddress,
        timestamp: t.blockTimestamp.getTime(),
      });
      byToken.set(key, arr);
    }

    const items = tokens.map((row) =>
      this.buildItem(row, params.window, now, byToken.get(row.address.toLowerCase()) ?? []),
    );

    const dir = params.order === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      const av = a[params.sort] as number;
      const bv = b[params.sort] as number;
      return (av - bv) * dir;
    });

    const total = items.length;
    const offset = params.cursor ? Math.max(0, Number.parseInt(params.cursor, 10) || 0) : 0;
    const page = items.slice(offset, offset + params.limit);
    page.forEach((it, i) => (it.rank = offset + i + 1));
    const nextOffset = offset + params.limit;
    const nextCursor = nextOffset < total ? String(nextOffset) : null;
    return { window: params.window, items: page, nextCursor, total };
  }

  private async tokenRow(address: string): Promise<TokenRow | null> {
    return (await this.prisma.token.findUnique({
      where: { chainId_address: { chainId: ROBINHOOD_CHAIN_ID, address } },
      select: {
        id: true,
        address: true,
        symbol: true,
        name: true,
        decimals: true,
        isVerified: true,
        firstSeenAt: true,
        circulatingSupply: true,
      },
    })) as TokenRow | null;
  }

  private async windowTrades(address: string, window: TimeWindow, now: number): Promise<RawMetricTrade[]> {
    const windowMs = TIME_WINDOW_MS[window];
    const rows = (await this.prisma.trade.findMany({
      where: {
        chainId: ROBINHOOD_CHAIN_ID,
        tokenAddress: address,
        blockTimestamp: { gte: new Date(now - 2 * windowMs) },
      },
      select: TRADE_SELECT,
    })) as unknown as Array<{
      side: 'BUY' | 'SELL';
      valueUsd: number | null;
      priceConfidence: number;
      walletClass: WalletClass;
      traderAddress: string;
      blockTimestamp: Date;
    }>;
    return rows.map((t) => ({
      side: t.side,
      valueUsd: t.valueUsd,
      priceConfidence: t.priceConfidence,
      walletClass: t.walletClass,
      traderAddress: t.traderAddress,
      timestamp: t.blockTimestamp.getTime(),
    }));
  }

  async detail(address: string, window: TimeWindow): Promise<Record<string, unknown> | null> {
    const row = await this.tokenRow(address);
    if (!row) return null;
    const now = this.clock();
    const all = await this.windowTrades(address, window, now);
    const item = this.buildItem(row, window, now, all);
    const token = this.meta.token(address);
    const pool = await this.prisma.liquidityPool.findFirst({
      where: { chainId: ROBINHOOD_CHAIN_ID, baseTokenId: row.id },
      select: { address: true, quoteTokenSymbol: true, liquidityUsd: true, dexId: true },
    });
    return {
      ...item,
      rank: null,
      isVerified: row.isVerified,
      liquidityChangePct: token?.liquidityChangePct ?? null,
      scenario: token?.scenario ?? null,
      pool: pool
        ? { address: pool.address, quoteSymbol: pool.quoteTokenSymbol, liquidityUsd: pool.liquidityUsd }
        : null,
      explorer: {
        token: `https://robinhoodchain.blockscout.com/token/${address}`,
      },
    };
  }

  async metrics(address: string, window: TimeWindow): Promise<Record<string, unknown> | null> {
    const row = await this.tokenRow(address);
    if (!row) return null;
    const now = this.clock();
    const all = (await this.windowTrades(address, window, now)).map(toMetricTrade);
    const windowMs = TIME_WINDOW_MS[window];
    const current = all.filter((t) => t.timestamp > now - windowMs && t.timestamp <= now);
    const prior = all.filter((t) => t.timestamp > now - 2 * windowMs && t.timestamp <= now - windowMs);
    const meta = this.meta.meta(address) ?? {
      priceUsd: null,
      priceConfidence: 0,
      liquidityUsd: null,
      liquidityChangePct: 0,
      contractVerified: row.isVerified,
    };
    const view = computeTokenView({ window, now, currentTrades: current, priorTrades: prior, meta });
    return { address, window, metrics: view.metrics };
  }

  async score(address: string, window: TimeWindow): Promise<Record<string, unknown> | null> {
    const row = await this.tokenRow(address);
    if (!row) return null;
    const now = this.clock();
    const all = (await this.windowTrades(address, window, now)).map(toMetricTrade);
    const windowMs = TIME_WINDOW_MS[window];
    const current = all.filter((t) => t.timestamp > now - windowMs && t.timestamp <= now);
    const prior = all.filter((t) => t.timestamp > now - 2 * windowMs && t.timestamp <= now - windowMs);
    const meta = this.meta.meta(address) ?? {
      priceUsd: null,
      priceConfidence: 0,
      liquidityUsd: null,
      liquidityChangePct: 0,
      contractVerified: row.isVerified,
    };
    const view = computeTokenView({ window, now, currentTrades: current, priorTrades: prior, meta });
    const explanations = explainTokenView(view, meta);
    return {
      address,
      window,
      opportunityScore: view.score.score,
      riskScore: view.score.riskScore,
      signal: view.score.signal,
      baseScore: view.score.baseScore,
      totalPenalty: view.score.totalPenalty,
      components: view.score.components,
      penalties: view.score.penalties,
      explanations,
    };
  }

  async trades(
    address: string,
    params: { limit: number; cursor?: string; side?: 'BUY' | 'SELL'; window?: TimeWindow },
  ): Promise<{ items: unknown[]; nextCursor: string | null } | null> {
    const row = await this.tokenRow(address);
    if (!row) return null;
    return this.tradeFeed({ tokenAddress: address, ...params });
  }

  /** Shared trade feed (used by token trades + live trades). Keyset by (blockTimestamp,id). */
  async tradeFeed(params: {
    tokenAddress?: string;
    traderAddress?: string;
    limit: number;
    cursor?: string;
    side?: 'BUY' | 'SELL';
    window?: TimeWindow;
  }): Promise<{ items: unknown[]; nextCursor: string | null }> {
    const now = this.clock();
    const where: Record<string, unknown> = { chainId: ROBINHOOD_CHAIN_ID };
    if (params.tokenAddress) where.tokenAddress = params.tokenAddress;
    if (params.traderAddress) where.traderAddress = params.traderAddress;
    if (params.side) where.side = params.side;
    if (params.window) where.blockTimestamp = { gte: new Date(now - TIME_WINDOW_MS[params.window]) };
    if (params.cursor) {
      const ts = Number.parseInt(params.cursor, 10);
      if (Number.isFinite(ts)) {
        where.blockTimestamp = { ...(where.blockTimestamp as object), lt: new Date(ts) };
      }
    }
    const rows = await this.prisma.trade.findMany({
      where,
      orderBy: [{ blockTimestamp: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
    });
    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? String(last.blockTimestamp.getTime()) : null;
    return { items: page.map((r) => serializeForWire(r)), nextCursor };
  }

  async holders(
    address: string,
    limit: number,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.tokenRow(address);
    if (!row) return null;
    const positions = await this.prisma.walletTokenPosition.findMany({
      where: { tokenId: row.id },
      include: { wallet: { select: { address: true, primaryClass: true } } },
    });
    const priced = this.meta.token(address)?.priceUsd ?? null;
    const supply =
      this.meta.token(address)?.circulatingSupply ??
      (row.circulatingSupply ? fromRawAmount(row.circulatingSupply, row.decimals) : null);

    const ranked = positions
      .map((p) => {
        const qty = fromRawAmount(p.currentQtyRaw, row.decimals);
        return {
          walletAddress: p.wallet.address,
          walletClass: p.wallet.primaryClass,
          quantity: qty,
          valueUsd: priced !== null ? qty * priced : null,
          supplyShare: supply && supply > 0 ? qty / supply : null,
          realizedPnlUsd: p.realizedPnlUsd,
          unrealizedPnlUsd: p.unrealizedPnlUsd,
        };
      })
      .filter((h) => h.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, limit);

    if (ranked.length === 0) {
      return {
        address,
        available: false,
        reason:
          'Top-holder data is derived from tracked swap positions; none are available for this token yet (positions accrue as the pipeline observes trades).',
        holders: [],
      };
    }
    return { address, available: true, holders: ranked };
  }
}
