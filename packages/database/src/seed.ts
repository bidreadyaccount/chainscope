/**
 * Deterministic demo seed (SPEC §18). Generates the demo dataset in
 * packages/shared and writes tokens, wallets and ≥5000 trades into Postgres.
 * Idempotent: re-running skips existing rows (unique constraints).
 */

import { generateDemoDataset } from '@chainscope/shared';
import { toRawAmount } from '@chainscope/shared';
import {
  generateDemoStocks,
  getDemoIndexDefs,
  generateDemoStockHistory,
  computeWeights,
  buildBasket,
  computeLevel,
  type ConstituentInput,
  type ConstituentWeight,
} from '@chainscope/shared';
import { ROBINHOOD_CHAIN } from '@chainscope/config';
import { prisma, disconnectPrisma } from './client.js';
import type { Prisma } from '../generated/client/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SEED = Number(process.env.DEMO_SEED ?? 1337);
const DEMO_DEX_NAME = 'RobinhoodSwap V2 (demo)';

function tokenId(symbol: string): string {
  return `demo_token_${symbol}`;
}
function walletId(address: string): string {
  return `demo_wallet_${address}`;
}

async function chunkedCreateMany<T>(
  rows: T[],
  size: number,
  create: (batch: T[]) => Promise<{ count: number }>,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += size) {
    const res = await create(rows.slice(i, i + size));
    total += res.count;
  }
  return total;
}

async function main(): Promise<void> {
  const now = Date.now();
  const ds = generateDemoDataset(SEED, now);
  console.info(
    `[seed] generated ${ds.tokens.length} tokens, ${ds.wallets.length} wallets, ${ds.trades.length} trades (seed=${SEED})`,
  );

  // 1. Chain
  await prisma.chain.upsert({
    where: { id: ROBINHOOD_CHAIN.id },
    create: {
      id: ROBINHOOD_CHAIN.id,
      name: ROBINHOOD_CHAIN.name,
      nativeSymbol: ROBINHOOD_CHAIN.nativeCurrency.symbol,
      rpcUrl: null,
      explorerUrl: ROBINHOOD_CHAIN.explorerBaseUrl,
    },
    update: {},
  });

  // 2. Dex
  const dex = await prisma.dex.upsert({
    where: { chainId_name: { chainId: ROBINHOOD_CHAIN.id, name: DEMO_DEX_NAME } },
    create: {
      chainId: ROBINHOOD_CHAIN.id,
      name: DEMO_DEX_NAME,
      protocol: 'UNISWAP_V2',
      isDemo: true,
    },
    update: {},
  });

  // 3. Tokens
  const tokenRows: Prisma.TokenCreateManyInput[] = ds.tokens.map((t) => ({
    id: tokenId(t.symbol),
    chainId: ROBINHOOD_CHAIN.id,
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    isVerified: t.scenario !== 'MIXED_LOW_CONFIDENCE',
    firstSeenAt: new Date(now - t.ageDays * DAY_MS),
    circulatingSupply: toRawAmount(t.circulatingSupply, t.decimals),
    isDemo: true,
  }));
  const tokenCount = await prisma.token.createMany({ data: tokenRows, skipDuplicates: true });

  // 4. Liquidity pools (one per token)
  const poolRows: Prisma.LiquidityPoolCreateManyInput[] = ds.tokens.map((t) => ({
    id: `demo_pool_${t.symbol}`,
    chainId: ROBINHOOD_CHAIN.id,
    address: t.poolAddress,
    dexId: dex.id,
    baseTokenId: tokenId(t.symbol),
    token0Address: t.address,
    token1Address: t.quoteAddress,
    quoteTokenAddress: t.quoteAddress,
    quoteTokenSymbol: t.quoteSymbol,
    liquidityUsd: t.liquidityUsd,
    isDemo: true,
  }));
  await prisma.liquidityPool.createMany({ data: poolRows, skipDuplicates: true });

  // 5. Wallets
  const walletRows: Prisma.WalletCreateManyInput[] = ds.wallets.map((w) => ({
    id: walletId(w.address),
    chainId: ROBINHOOD_CHAIN.id,
    address: w.address,
    firstSeenAt: new Date(now - w.firstSeenDaysAgo * DAY_MS),
    lastSeenAt: new Date(now),
    lifetimeTxCount: w.lifetimeTxs,
    portfolioValueUsd: w.portfolioUsd,
    primaryClass: w.primaryClass,
    classificationConfidence: w.classificationConfidence,
    isProfitable: w.isProfitable,
    fundingSourceAddress: w.fundingSourceAddress ?? null,
    isDemo: true,
  }));
  const walletCount = await prisma.wallet.createMany({ data: walletRows, skipDuplicates: true });

  // 6. Trades
  const tokenIdByAddress = new Map(ds.tokens.map((t) => [t.address, tokenId(t.symbol)]));
  const tradeRows: Prisma.TradeCreateManyInput[] = ds.trades.map((t) => ({
    id: t.id,
    chainId: t.chainId,
    transactionHash: t.transactionHash,
    logIndex: t.logIndex,
    blockNumber: t.blockNumber,
    blockTimestamp: t.blockTimestamp,
    dexName: t.dexName,
    routerAddress: t.routerAddress ?? null,
    poolAddress: t.poolAddress,
    traderAddress: t.traderAddress,
    tokenId: tokenIdByAddress.get(t.tokenAddress)!,
    tokenAddress: t.tokenAddress,
    tokenSymbol: t.tokenSymbol,
    quoteTokenAddress: t.quoteTokenAddress,
    quoteTokenSymbol: t.quoteTokenSymbol,
    side: t.side,
    tokenAmount: t.tokenAmount,
    quoteAmount: t.quoteAmount,
    priceUsd: t.priceUsd,
    valueUsd: t.valueUsd,
    priceConfidence: t.priceConfidence,
    walletClass: t.walletClass,
    walletClassificationConfidence: t.walletClassificationConfidence,
    walletId: walletId(t.traderAddress),
    isDemo: true,
  }));
  const tradeCount = await chunkedCreateMany(tradeRows, 1000, (batch) =>
    prisma.trade.createMany({ data: batch, skipDuplicates: true }),
  );

  // 7. Block checkpoint
  const maxBlock = ds.trades.reduce((m, t) => (t.blockNumber > m ? t.blockNumber : m), 0n);
  await prisma.blockCheckpoint.upsert({
    where: { chainId_stream: { chainId: ROBINHOOD_CHAIN.id, stream: 'demo' } },
    create: {
      chainId: ROBINHOOD_CHAIN.id,
      stream: 'demo',
      lastIndexedBlock: maxBlock,
      lastFinalizedBlock: maxBlock,
      headBlock: maxBlock,
    },
    update: { lastIndexedBlock: maxBlock, lastFinalizedBlock: maxBlock, headBlock: maxBlock },
  });

  // --- Stock-token index layer (demo, illustrative) ---
  await seedStockIndexLayer(now);

  // Verify with count queries.
  const [tokens, wallets, trades] = await Promise.all([
    prisma.token.count(),
    prisma.wallet.count(),
    prisma.trade.count(),
  ]);

  console.info(
    `[seed] inserted this run — tokens:${tokenCount.count} wallets:${walletCount.count} trades:${tradeCount}`,
  );
  console.info(`[seed] table totals — tokens:${tokens} wallets:${wallets} trades:${trades}`);
}

const stockId = (ticker: string): string => `demo_stock_${ticker}`;
const indexId = (slug: string): string => `demo_index_${slug}`;

/**
 * Seed the demo stock-token universe and curated indexes. Weights are computed
 * by the index engine from the demo fundamentals; NAV history is derived from
 * the deterministic per-stock price history so index charts have real series.
 * Idempotent via upserts on stable ids + unique slugs/tickers.
 */
async function seedStockIndexLayer(now: number): Promise<void> {
  const stocks = generateDemoStocks(Number(process.env.DEMO_SEED ?? 1337));
  const indexDefs = getDemoIndexDefs();
  const history = generateDemoStockHistory(stocks, now, 120);

  // 1. Stock tokens.
  for (const s of stocks) {
    const data = {
      chainId: ROBINHOOD_CHAIN.id,
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
      oracleStatus: s.oracleStatus,
      enabled: true,
      isDemo: true,
    };
    await prisma.stockToken.upsert({
      where: { id: stockId(s.ticker) },
      create: { id: stockId(s.ticker), ...data },
      update: data,
    });
  }

  const stockByTicker = new Map(stocks.map((s) => [s.ticker, s]));
  // Group price history by day for NAV series.
  const dayMs = 86_400_000;
  const days = 120;

  // 2. Indexes + constituents + NAV snapshots.
  for (const def of indexDefs) {
    const members = def.tickers.map((t) => stockByTicker.get(t)!).filter(Boolean);
    const constituentInputs: ConstituentInput[] = members.map((s) => ({
      stockTokenId: stockId(s.ticker),
      ticker: s.ticker,
      sector: s.sector,
      priceUsd: s.priceUsd,
      marketCapUsd: s.marketCapUsd,
      volatility: s.volatility,
    }));
    const weightResult = computeWeights(constituentInputs, def.methodology, {
      maxWeightBps: def.maxWeightBps,
      minConstituents: 2,
    });
    const weights: ConstituentWeight[] = weightResult.weights;

    await prisma.index.upsert({
      where: { id: indexId(def.slug) },
      create: {
        id: indexId(def.slug),
        slug: def.slug,
        name: def.name,
        symbol: def.symbol,
        description: def.description,
        category: def.category,
        methodology: def.methodology,
        maxWeightBps: def.maxWeightBps,
        rebalanceSchedule: def.rebalanceSchedule,
        benchmark: def.benchmark,
        baseValue: 1000,
        divisor: 1,
        isCurated: true,
        isDemo: true,
      },
      update: { methodology: def.methodology, maxWeightBps: def.maxWeightBps, divisor: 1 },
    });

    for (const w of weights) {
      await prisma.indexConstituent.upsert({
        where: {
          indexId_stockTokenId: { indexId: indexId(def.slug), stockTokenId: w.stockTokenId },
        },
        create: {
          indexId: indexId(def.slug),
          stockTokenId: w.stockTokenId,
          targetWeightBps: w.weightBps,
        },
        update: { targetWeightBps: w.weightBps },
      });
    }

    // NAV history: build the basket at the earliest day (weights fixed), then
    // mark-to-market each day using that day's constituent prices.
    const priceOnDay = (dayIndex: number): Map<string, number | null> => {
      const takenAt = now - (days - dayIndex) * dayMs;
      const map = new Map<string, number | null>();
      for (const s of members) {
        const pt = history.find((h) => h.ticker === s.ticker && h.takenAt === takenAt);
        map.set(stockId(s.ticker), pt ? pt.priceUsd : s.priceUsd);
      }
      return map;
    };
    const basket = buildBasket(weights, priceOnDay(0), 1000);
    const navRows: Prisma.IndexNavSnapshotCreateManyInput[] = [];
    for (let d = 0; d <= days; d++) {
      const lvl = computeLevel(basket, priceOnDay(d));
      navRows.push({
        indexId: indexId(def.slug),
        level: lvl.level,
        navUsd: lvl.navUsd,
        divisor: basket.divisor,
        takenAt: new Date(now - (days - d) * dayMs),
      });
    }
    // Replace snapshots idempotently (delete + recreate for this index).
    await prisma.indexNavSnapshot.deleteMany({ where: { indexId: indexId(def.slug) } });
    await prisma.indexNavSnapshot.createMany({ data: navRows });
  }

  const [stockCount, idxCount, navCount] = await Promise.all([
    prisma.stockToken.count(),
    prisma.index.count(),
    prisma.indexNavSnapshot.count(),
  ]);
  console.info(
    `[seed] stock layer — stocks:${stockCount} indexes:${idxCount} navSnapshots:${navCount}`,
  );
}

main()
  .then(async () => {
    await disconnectPrisma();
    console.info('[seed] done');
  })
  .catch(async (err) => {
    console.error('[seed] failed:', err);
    await disconnectPrisma();
    process.exit(1);
  });
