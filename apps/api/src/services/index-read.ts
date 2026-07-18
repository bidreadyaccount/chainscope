/**
 * Read model for the stock-token index layer. Loads curated indexes, their
 * constituents and NAV history, and derives display views with the pure index
 * engine (weights are stored; sector allocation, concentration, performance and
 * live level are computed on read from current stock prices + NAV snapshots).
 * Every value leaving here is JSON-safe.
 */

import { ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import {
  computeSectorAllocation,
  computeConcentration,
  computePerformance,
  type ConstituentInput,
  type ConstituentWeight,
  type PerformancePoint,
} from '@chainscope/shared';
import type { PrismaClient } from '@chainscope/database';

export interface IndexListItem {
  slug: string;
  name: string;
  symbol: string;
  category: string | null;
  methodology: string;
  constituentCount: number;
  latestLevel: number | null;
  baseValue: number;
  return30d: number | null;
  returnYtd: number | null;
  annualizedVolatility: number | null;
  benchmark: string | null;
  isDemo: boolean;
}

export class IndexReadService {
  constructor(private readonly prisma: PrismaClient) {}

  private explorerBase(): string {
    return 'https://robinhoodchain.blockscout.com';
  }

  /** Curated index list with headline stats. */
  async list(): Promise<{ items: IndexListItem[]; total: number }> {
    const indexes = await this.prisma.index.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { constituents: true } } },
    });

    const items: IndexListItem[] = [];
    for (const idx of indexes) {
      const navPoints = await this.navPoints(idx.id);
      const perf = computePerformance(navPoints);
      items.push({
        slug: idx.slug,
        name: idx.name,
        symbol: idx.symbol,
        category: idx.category,
        methodology: idx.methodology,
        constituentCount: idx._count.constituents,
        latestLevel: perf.latestLevel,
        baseValue: idx.baseValue,
        return30d: perf.returns['30d'] ?? null,
        returnYtd: perf.returns['ytd'] ?? null,
        annualizedVolatility: perf.annualizedVolatility,
        benchmark: idx.benchmark,
        isDemo: idx.isDemo,
      });
    }
    return { items, total: items.length };
  }

  private async navPoints(indexId: string): Promise<PerformancePoint[]> {
    const snaps = await this.prisma.indexNavSnapshot.findMany({
      where: { indexId },
      orderBy: { takenAt: 'asc' },
      select: { level: true, takenAt: true },
    });
    return snaps.map((s) => ({ takenAt: s.takenAt.getTime(), level: s.level }));
  }

  /** Full index detail: constituents, weights, sector allocation, risk, perf. */
  async detail(slug: string): Promise<unknown | null> {
    const idx = await this.prisma.index.findUnique({
      where: { slug },
      include: {
        constituents: { include: { stockToken: true }, orderBy: { targetWeightBps: 'desc' } },
      },
    });
    if (!idx) return null;

    const weights: ConstituentWeight[] = idx.constituents.map((c) => ({
      stockTokenId: c.stockTokenId,
      ticker: c.stockToken.ticker,
      weightBps: c.targetWeightBps,
    }));
    const constituentInputs: ConstituentInput[] = idx.constituents.map((c) => ({
      stockTokenId: c.stockTokenId,
      ticker: c.stockToken.ticker,
      sector: c.stockToken.sector,
      priceUsd: c.stockToken.priceUsd,
      marketCapUsd: c.stockToken.marketCapUsd,
      volatility: c.stockToken.volatility,
    }));

    const sectorAllocation = computeSectorAllocation(weights, constituentInputs);
    const concentration = computeConcentration(weights);
    const navPoints = await this.navPoints(idx.id);
    const performance = computePerformance(navPoints);

    return {
      slug: idx.slug,
      name: idx.name,
      symbol: idx.symbol,
      description: idx.description,
      category: idx.category,
      methodology: idx.methodology,
      maxWeightBps: idx.maxWeightBps,
      rebalanceSchedule: idx.rebalanceSchedule,
      benchmark: idx.benchmark,
      baseValue: idx.baseValue,
      isDemo: idx.isDemo,
      performance,
      concentration,
      sectorAllocation,
      constituents: idx.constituents.map((c) => ({
        ticker: c.stockToken.ticker,
        companyName: c.stockToken.companyName,
        sector: c.stockToken.sector,
        weightBps: c.targetWeightBps,
        priceUsd: c.stockToken.priceUsd,
        marketCapUsd: c.stockToken.marketCapUsd,
        dividendYield: c.stockToken.dividendYield,
        colorTheme: c.stockToken.colorTheme,
        riskRating: c.stockToken.riskRating,
      })),
      navHistory: navPoints.map((p) => ({
        takenAt: new Date(p.takenAt).toISOString(),
        level: p.level,
      })),
    };
  }

  /** Stock-token registry list. */
  async listStocks(sector?: string): Promise<{ items: unknown[]; total: number }> {
    const stocks = await this.prisma.stockToken.findMany({
      where: { chainId: ROBINHOOD_CHAIN_ID, enabled: true, ...(sector ? { sector } : {}) },
      orderBy: { marketCapUsd: 'desc' },
    });
    return {
      items: stocks.map((s) => ({
        ticker: s.ticker,
        companyName: s.companyName,
        sector: s.sector,
        industry: s.industry,
        priceUsd: s.priceUsd,
        priceConfidence: s.priceConfidence,
        marketCapUsd: s.marketCapUsd,
        dividendYield: s.dividendYield,
        volatility: s.volatility,
        riskRating: s.riskRating,
        colorTheme: s.colorTheme,
        oracleStatus: s.oracleStatus,
        isDemo: s.isDemo,
      })),
      total: stocks.length,
    };
  }

  /** Single stock-token detail, including which indexes hold it. */
  async stockDetail(ticker: string): Promise<unknown | null> {
    const s = await this.prisma.stockToken.findUnique({
      where: { chainId_ticker: { chainId: ROBINHOOD_CHAIN_ID, ticker: ticker.toUpperCase() } },
      include: { constituents: { include: { index: true } } },
    });
    if (!s) return null;
    return {
      ticker: s.ticker,
      companyName: s.companyName,
      sector: s.sector,
      industry: s.industry,
      description: s.description,
      contractAddress: s.contractAddress,
      priceFeedAddress: s.priceFeedAddress,
      decimals: s.decimals,
      priceUsd: s.priceUsd,
      priceConfidence: s.priceConfidence,
      marketCapUsd: s.marketCapUsd,
      sharesOutstanding: s.sharesOutstanding,
      dividendYield: s.dividendYield,
      volatility: s.volatility,
      assetClass: s.assetClass,
      country: s.country,
      currency: s.currency,
      riskRating: s.riskRating,
      colorTheme: s.colorTheme,
      tradingEnabled: s.tradingEnabled,
      oracleStatus: s.oracleStatus,
      isDemo: s.isDemo,
      explorer: {
        // Contract addresses are demo/fake — link only when present.
        token: s.contractAddress ? `${this.explorerBase()}/token/${s.contractAddress}` : null,
      },
      memberOfIndexes: s.constituents.map((c) => ({
        slug: c.index.slug,
        name: c.index.name,
        symbol: c.index.symbol,
        weightBps: c.targetWeightBps,
      })),
    };
  }
}
