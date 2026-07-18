/**
 * Read model for the stock-token index layer. Loads curated indexes, their
 * constituents and NAV history, and derives display views with the pure index
 * engine (weights are stored; sector allocation, concentration, performance and
 * live level are computed on read from current stock prices + NAV snapshots).
 * Every value leaving here is JSON-safe.
 */

import {
  ROBINHOOD_CHAIN_ID,
  type IndexMethodology,
  DEFAULT_INDEX_CONSTRAINTS,
  WEIGHT_DENOMINATOR_BPS,
} from '@chainscope/config';
import {
  computeSectorAllocation,
  computeConcentration,
  computePerformance,
  computeWeights,
  buildManualWeights,
  simulateInvestment,
  type ConstituentInput,
  type ConstituentWeight,
  type ManualWeightInput,
  type PerformancePoint,
} from '@chainscope/shared';
import type { PrismaClient } from '@chainscope/database';

export interface PreviewInput {
  tickers: string[];
  methodology?: IndexMethodology;
  manualWeights?: Array<{ ticker: string; weight: number }>;
  maxWeightBps?: number;
}

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

  /**
   * Custom index builder preview (compute-only, no persistence). Loads the named
   * stock tokens, runs the index engine (methodology or manual weights), and
   * returns weights + sector allocation + concentration + any exclusions/errors.
   */
  async preview(input: PreviewInput): Promise<unknown> {
    const tickers = [...new Set(input.tickers.map((t) => t.toUpperCase()))];
    const stocks = await this.prisma.stockToken.findMany({
      where: { chainId: ROBINHOOD_CHAIN_ID, ticker: { in: tickers } },
    });
    const byTicker = new Map(stocks.map((s) => [s.ticker, s]));
    const unknownTickers = tickers.filter((t) => !byTicker.has(t));
    const maxWeightBps = input.maxWeightBps ?? WEIGHT_DENOMINATOR_BPS;
    const constraints = {
      maxWeightBps,
      minConstituents: DEFAULT_INDEX_CONSTRAINTS.minConstituents,
    };

    const result = input.manualWeights
      ? buildManualWeights(
          input.manualWeights
            .filter((w) => byTicker.has(w.ticker.toUpperCase()))
            .map<ManualWeightInput>((w) => ({
              stockTokenId: byTicker.get(w.ticker.toUpperCase())!.id,
              ticker: w.ticker.toUpperCase(),
              weight: w.weight,
            })),
          constraints,
        )
      : computeWeights(
          stocks.map<ConstituentInput>((s) => ({
            stockTokenId: s.id,
            ticker: s.ticker,
            sector: s.sector,
            priceUsd: s.priceUsd,
            marketCapUsd: s.marketCapUsd,
            volatility: s.volatility,
          })),
          input.methodology ?? 'MARKET_CAP',
          constraints,
        );

    const constituentInputs: ConstituentInput[] = stocks.map((s) => ({
      stockTokenId: s.id,
      ticker: s.ticker,
      sector: s.sector,
      priceUsd: s.priceUsd,
      marketCapUsd: s.marketCapUsd,
      volatility: s.volatility,
    }));
    const sectorAllocation = result.ok
      ? computeSectorAllocation(result.weights, constituentInputs)
      : [];
    const concentration = result.ok ? computeConcentration(result.weights) : null;

    return {
      ok: result.ok,
      error: result.error ?? null,
      methodology: result.methodology,
      maxWeightBps,
      unknownTickers,
      excluded: result.excluded,
      weights: result.weights.map((w) => {
        const s = byTicker.get(w.ticker);
        return {
          ticker: w.ticker,
          companyName: s?.companyName ?? w.ticker,
          sector: s?.sector ?? 'Unknown',
          weightBps: w.weightBps,
          priceUsd: s?.priceUsd ?? null,
          marketCapUsd: s?.marketCapUsd ?? null,
          colorTheme: s?.colorTheme ?? null,
        };
      }),
      sectorAllocation,
      concentration,
    };
  }

  /**
   * Portfolio simulator for an existing index: split `amountUsd` across the
   * index's current constituents and project the same investment over the
   * index's NAV history. Read-only — no order is placed and nothing is persisted.
   */
  async simulate(slug: string, amountUsd: number): Promise<unknown | null> {
    const idx = await this.prisma.index.findUnique({
      where: { slug },
      include: { constituents: { include: { stockToken: true } } },
    });
    if (!idx) return null;

    const weights: ConstituentWeight[] = idx.constituents.map((c) => ({
      stockTokenId: c.stockTokenId,
      ticker: c.stockToken.ticker,
      weightBps: c.targetWeightBps,
    }));
    const prices = new Map<string, number | null>(
      idx.constituents.map((c) => [c.stockTokenId, c.stockToken.priceUsd]),
    );
    const nav = await this.navPoints(idx.id);
    const sim = simulateInvestment(amountUsd, weights, prices, nav);

    const byId = new Map(idx.constituents.map((c) => [c.stockTokenId, c.stockToken]));
    return {
      slug: idx.slug,
      symbol: idx.symbol,
      name: idx.name,
      benchmark: idx.benchmark,
      // Benchmark comparison is intentionally not fabricated: no benchmark price
      // series is ingested yet, so we report the portfolio's own trajectory only.
      benchmarkComparisonAvailable: false,
      amountUsd: sim.amountUsd,
      investedWeightBps: sim.investedWeightBps,
      projectionAvailable: sim.projectionAvailable,
      projectionUnavailableReason: sim.projectionUnavailableReason,
      finalValueUsd: sim.finalValueUsd,
      totalReturn: sim.totalReturn,
      excluded: sim.excluded,
      allocations: sim.allocations.map((a) => ({
        ...a,
        companyName: byId.get(a.stockTokenId)?.companyName ?? a.ticker,
        sector: byId.get(a.stockTokenId)?.sector ?? 'Unknown',
        colorTheme: byId.get(a.stockTokenId)?.colorTheme ?? null,
      })),
      valueSeries: sim.valueSeries.map((p) => ({
        takenAt: new Date(p.takenAt).toISOString(),
        valueUsd: p.valueUsd,
      })),
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
