/**
 * Data-status payload (SPEC §14I / §17 /status). Reports datastore health,
 * indexer checkpoint + lag, demo/live mode, configured DEX adapters and data
 * coverage. Never exposes secrets.
 */

import { ROBINHOOD_CHAIN, ROBINHOOD_CHAIN_ID, type Env } from '@chainscope/config';
import type { PrismaClient } from '@chainscope/database';
import type { RedisClient } from '../lib/redis.js';
import type { DemoStreamService } from '../pipeline/demo-stream.js';

export interface StatusDeps {
  readonly prisma: PrismaClient;
  readonly redis: RedisClient;
  readonly env: Env;
  readonly stream?: DemoStreamService;
  readonly startedAt: number;
}

async function ping(fn: () => Promise<unknown>): Promise<{ status: 'ok' | 'error'; latencyMs: number }> {
  const t0 = Date.now();
  try {
    await fn();
    return { status: 'ok', latencyMs: Date.now() - t0 };
  } catch {
    return { status: 'error', latencyMs: Date.now() - t0 };
  }
}

export async function buildStatus(deps: StatusDeps): Promise<Record<string, unknown>> {
  const { prisma, redis, env, stream } = deps;

  const [db, redisHealth, checkpoint, tokens, trades, wallets, positions, dexes] = await Promise.all([
    ping(() => prisma.$queryRaw`SELECT 1`),
    ping(() => redis.ping()),
    prisma.blockCheckpoint.findFirst({
      where: { chainId: ROBINHOOD_CHAIN_ID },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.token.count(),
    prisma.trade.count(),
    prisma.wallet.count(),
    prisma.walletTokenPosition.count(),
    prisma.dex.findMany({ select: { name: true, protocol: true, enabled: true, isDemo: true } }),
  ]);

  const lastIndexedBlock = checkpoint ? checkpoint.lastIndexedBlock.toString() : null;
  const headBlock = checkpoint?.headBlock ? checkpoint.headBlock.toString() : null;
  const lag =
    checkpoint && checkpoint.headBlock !== null
      ? (checkpoint.headBlock - checkpoint.lastIndexedBlock).toString()
      : null;

  const liveConfigured = Boolean(env.ROBINHOOD_RPC_URL);

  return {
    mode: env.DATA_MODE,
    chain: { id: ROBINHOOD_CHAIN.id, name: ROBINHOOD_CHAIN.name, verified: ROBINHOOD_CHAIN.verified },
    uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
    datastores: { database: db, redis: redisHealth },
    rpc: {
      // In demo mode no RPC connection is made; report configuration only.
      configured: liveConfigured,
      connected: env.DATA_MODE === 'live' && liveConfigured,
      websocketConfigured: Boolean(env.ROBINHOOD_WS_URL),
    },
    indexer: {
      lastIndexedBlock,
      headBlock,
      lagBlocks: lag,
      confirmations: env.CHAIN_CONFIRMATIONS,
      running: env.DATA_MODE === 'demo' ? Boolean(stream?.isRunning()) : false,
    },
    demoStream: stream ? stream.stats() : { running: false, ingested: 0, lastTradeAt: null, intervalMs: 0 },
    adapters: dexes,
    coverage: { tokens, trades, wallets, positions },
  };
}
