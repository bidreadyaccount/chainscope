/**
 * Server context: the service container decorated onto the Fastify instance so
 * routes can reach the DB, Redis, engines and pipeline via `app.services`.
 */

import type { Env } from '@chainscope/config';
import type { PrismaClient } from '@chainscope/database';
import type { RedisClient } from './lib/redis.js';
import type { TokenMetaProvider } from './services/token-meta.js';
import type { RankingsService } from './services/rankings.js';
import type { PubSub } from './services/pubsub.js';
import type { TokenReadService } from './services/token-read.js';
import type { WalletReadService } from './services/wallet-read.js';
import type { Pipeline } from './pipeline/pipeline.js';
import type { DemoStreamService } from './pipeline/demo-stream.js';
import type { WsHub } from './ws/hub.js';

export interface Services {
  readonly env: Env;
  readonly prisma: PrismaClient;
  readonly redis: RedisClient;
  readonly redisSub: RedisClient;
  readonly meta: TokenMetaProvider;
  readonly rankings: RankingsService;
  readonly pubsub: PubSub;
  readonly tokens: TokenReadService;
  readonly wallets: WalletReadService;
  readonly pipeline: Pipeline;
  readonly stream: DemoStreamService | null;
  readonly wsHub: WsHub;
  readonly startedAt: number;
  readonly clock: () => number;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}
