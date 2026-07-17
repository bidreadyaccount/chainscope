/**
 * Deterministic demo seed (SPEC §18). Generates the demo dataset in
 * packages/shared and writes tokens, wallets and ≥5000 trades into Postgres.
 * Idempotent: re-running skips existing rows (unique constraints).
 */

import { generateDemoDataset } from '@chainscope/shared';
import { toRawAmount } from '@chainscope/shared';
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
