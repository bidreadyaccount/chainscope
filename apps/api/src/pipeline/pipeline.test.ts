import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import type { NormalizedTrade } from '@chainscope/shared';
import { prisma, disconnectPrisma } from '@chainscope/database';
import { createRedis, type RedisClient } from '../lib/redis.js';
import { RankingsService } from '../services/rankings.js';
import { PubSub } from '../services/pubsub.js';
import { createDemoTokenMetaProvider } from '../services/token-meta.js';
import { wsChannel } from '../lib/keys.js';
import { Pipeline } from './pipeline.js';

const TOKEN_ID = 'test_pipeline_token';
const WALLET_ID = 'test_pipeline_wallet';
const TOKEN_ADDR = ('0x' + 'e'.repeat(40)) as `0x${string}`;
const TRADER_ADDR = ('0x' + 'f'.repeat(40)) as `0x${string}`;
const TX = ('0xDEMO' + '1'.repeat(60)) as `0x${string}`;

function synthTrade(): NormalizedTrade {
  return {
    id: 'test_pipeline_trade_1',
    chainId: ROBINHOOD_CHAIN_ID,
    transactionHash: TX,
    logIndex: 0,
    blockNumber: 1n,
    blockTimestamp: new Date(),
    dexName: 'test-dex',
    poolAddress: ('0x' + '1'.repeat(40)) as `0x${string}`,
    traderAddress: TRADER_ADDR,
    tokenAddress: TOKEN_ADDR,
    tokenSymbol: 'TST',
    quoteTokenAddress: ('0x' + '2'.repeat(40)) as `0x${string}`,
    quoteTokenSymbol: 'USDC',
    side: 'BUY',
    tokenAmount: '1000000000000000000',
    quoteAmount: '5000000000',
    priceUsd: 5,
    valueUsd: 5000,
    priceConfidence: 80,
    walletClass: 'WHALE',
    walletClassificationConfidence: 90,
    isDemo: true,
  };
}

describe('Pipeline.ingest — synthetic trade end-to-end', () => {
  let redis: RedisClient;
  let sub: RedisClient;
  let pipeline: Pipeline;
  const received: Array<{ type: string; data: { tokenAddress?: string } }> = [];

  beforeAll(async () => {
    await prisma.token.upsert({
      where: { id: TOKEN_ID },
      create: {
        id: TOKEN_ID,
        chainId: ROBINHOOD_CHAIN_ID,
        address: TOKEN_ADDR,
        symbol: 'TST',
        name: 'Test Token',
        decimals: 18,
        isDemo: true,
      },
      update: {},
    });
    await prisma.wallet.upsert({
      where: { id: WALLET_ID },
      create: { id: WALLET_ID, chainId: ROBINHOOD_CHAIN_ID, address: TRADER_ADDR, isDemo: true },
      update: {},
    });

    redis = createRedis(process.env.REDIS_URL!);
    sub = createRedis(process.env.REDIS_URL!);
    await sub.subscribe(wsChannel('trade'), wsChannel('score'));
    sub.on('message', (_ch, payload) => {
      try {
        received.push(JSON.parse(payload));
      } catch {
        /* ignore */
      }
    });

    const rankings = new RankingsService(redis);
    await rankings.clear();
    const pubsub = new PubSub(redis);
    const meta = createDemoTokenMetaProvider(1337);
    pipeline = new Pipeline({
      prisma,
      rankings,
      pubsub,
      meta,
      logger: { warn() {}, error() {}, info() {} } as never,
    });
    await pipeline.init();
  });

  afterAll(async () => {
    await new RankingsService(redis).clear();
    sub.disconnect();
    redis.disconnect();
    // token delete cascades trades/positions/snapshots.
    await prisma.token.delete({ where: { id: TOKEN_ID } }).catch(() => undefined);
    await prisma.wallet.delete({ where: { id: WALLET_ID } }).catch(() => undefined);
    await disconnectPrisma();
  });

  it('persists the trade, updates the position, recomputes rankings and publishes', async () => {
    await pipeline.ingest(synthTrade());

    // Trade persisted (idempotent key).
    const trade = await prisma.trade.findFirst({ where: { id: 'test_pipeline_trade_1' } });
    expect(trade).not.toBeNull();

    // Position updated via cost-basis engine (bought 1 whole token).
    const pos = await prisma.walletTokenPosition.findUnique({
      where: { walletId_tokenId: { walletId: WALLET_ID, tokenId: TOKEN_ID } },
    });
    expect(pos).not.toBeNull();
    expect(pos!.currentQtyRaw).toBe('1000000000000000000');
    expect(pos!.avgEntryCostUsd).toBeCloseTo(5000, 0);

    // Rankings sorted set now contains the token.
    const rankings = new RankingsService(redis);
    const opp = await rankings.read('opportunity', '1h', 50);
    expect(opp.some((e) => e.address.toLowerCase() === TOKEN_ADDR.toLowerCase())).toBe(true);

    // A snapshot was persisted (forced on first recompute is throttled; here default snapshotDue is true).
    const snap = await prisma.tokenScoreSnapshot.findFirst({
      where: { tokenId: TOKEN_ID, window: '1h' },
    });
    expect(snap).not.toBeNull();

    // Envelopes published to Redis (allow pub/sub to deliver).
    await new Promise((r) => setTimeout(r, 200));
    const types = received.map((m) => m.type);
    expect(types).toContain('trade');
    expect(types).toContain('score');
    const tradeMsg = received.find((m) => m.type === 'trade');
    expect(tradeMsg?.data.tokenAddress?.toLowerCase()).toBe(TOKEN_ADDR.toLowerCase());
  });
});
