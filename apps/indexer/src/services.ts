/**
 * Indexer service wiring. Constructs the datastore-backed collaborators the
 * engine needs — Redis, RankingsService, PubSub, the Pipeline (the SAME class
 * the API uses; Phase 3 handoff), the token-metadata provider, the checkpoint
 * manager and the error recorder — and selects the provider + runtime config for
 * the active DATA_MODE.
 *
 * The Pipeline publishes to `cs:ws:*`; any running API instance fans those out
 * to its WebSocket clients automatically (Redis pub/sub), so a standalone
 * indexer process drives the live dashboard without further coupling.
 */

import type { Env } from '@chainscope/config';
import { ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import { prisma } from '@chainscope/database';
import { createRedis, type RedisClient } from '@chainscope/api/lib/redis.js';
import { RankingsService } from '@chainscope/api/services/rankings.js';
import { PubSub } from '@chainscope/api/services/pubsub.js';
import { Pipeline } from '@chainscope/api/pipeline/pipeline.js';
import {
  createDemoTokenMetaProvider,
  type TokenMetaProvider,
} from '@chainscope/api/services/token-meta.js';
import type { TokenMeta } from '@chainscope/api/services/analytics.js';
import type { Logger as PinoLogger } from 'pino';
import type { ChainProvider } from './provider/types.js';
import { DemoProvider } from './provider/demo-provider.js';
import { LiveProvider, createViemRpcClient } from './provider/live-provider.js';
import { CheckpointManager } from './checkpoint.js';
import { IndexerErrorRecorder } from './errors.js';
import { buildDemoRuntime, buildLiveRuntime, type RuntimeConfig } from './runtime-config.js';

/** A live TokenMetaProvider that reads nothing (price engine is future work). */
function createLiveTokenMetaProvider(): TokenMetaProvider {
  const empty: TokenMeta = {
    priceUsd: null,
    priceConfidence: 0,
    liquidityUsd: null,
    liquidityChangePct: 0,
    contractVerified: true,
  };
  void empty;
  return {
    meta: () => undefined,
    token: () => undefined,
    addresses: () => [],
  };
}

export interface IndexerServices {
  readonly env: Env;
  readonly redis: RedisClient;
  readonly rankings: RankingsService;
  readonly pubsub: PubSub;
  readonly meta: TokenMetaProvider;
  readonly pipeline: Pipeline;
  readonly provider: ChainProvider;
  readonly runtime: RuntimeConfig;
  readonly checkpoint: CheckpointManager;
  readonly errors: IndexerErrorRecorder;
  readonly close: () => Promise<void>;
}

export async function buildIndexerServices(
  env: Env,
  logger: PinoLogger,
): Promise<IndexerServices> {
  const redis = createRedis(env.REDIS_URL);
  const rankings = new RankingsService(redis);
  const pubsub = new PubSub(redis);

  const isDemo = env.DATA_MODE === 'demo';
  const meta = isDemo ? createDemoTokenMetaProvider(env.DEMO_SEED) : createLiveTokenMetaProvider();

  type PipelineLogger = ConstructorParameters<typeof Pipeline>[0]['logger'];
  const pipeline = new Pipeline({
    prisma,
    rankings,
    pubsub,
    meta,
    logger: logger as unknown as PipelineLogger,
    snapshotIntervalMs: 10_000,
  });
  await pipeline.init();

  const runtime: RuntimeConfig = isDemo
    ? buildDemoRuntime(env.DEMO_SEED)
    : await buildLiveRuntime(prisma, env);

  const provider: ChainProvider = isDemo
    ? new DemoProvider({ seed: env.DEMO_SEED })
    : new LiveProvider(
        createViemRpcClient({
          httpUrl: env.ROBINHOOD_RPC_URL,
          wsUrl: env.ROBINHOOD_WS_URL,
        }),
        { pollIntervalMs: env.CHAIN_POLL_INTERVAL_MS, failureThreshold: 5 },
      );

  const checkpoint = new CheckpointManager(prisma, {
    chainId: ROBINHOOD_CHAIN_ID,
    stream: runtime.stream,
  });
  await checkpoint.load();

  const errors = new IndexerErrorRecorder(prisma, ROBINHOOD_CHAIN_ID, logger);

  const close = async (): Promise<void> => {
    await provider.close();
    redis.disconnect();
  };

  return {
    env,
    redis,
    rankings,
    pubsub,
    meta,
    pipeline,
    provider,
    runtime,
    checkpoint,
    errors,
    close,
  };
}
