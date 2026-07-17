import './lib/load-dotenv.js';

import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';

import { loadEnv, type Env } from '@chainscope/config';
import { stringifyForWire } from '@chainscope/shared';
import { prisma, disconnectPrisma } from '@chainscope/database';

import './context.js';
import { createRedis } from './lib/redis.js';
import { AppError, toErrorBody } from './lib/errors.js';
import { createDemoTokenMetaProvider } from './services/token-meta.js';
import { RankingsService } from './services/rankings.js';
import { PubSub } from './services/pubsub.js';
import { TokenReadService } from './services/token-read.js';
import { WalletReadService } from './services/wallet-read.js';
import { Pipeline } from './pipeline/pipeline.js';
import { DemoStreamService } from './pipeline/demo-stream.js';
import { WsHub } from './ws/hub.js';
import { apiRoutes } from './routes/index.js';
import { healthRoutes } from './routes/health.js';
import { wsRoutes } from './routes/ws.js';

export interface BuildServerOptions {
  readonly env?: Env;
  readonly clock?: () => number;
  /** Body size limit in bytes (default 256 KiB). */
  readonly bodyLimit?: number;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const env = opts.env ?? loadEnv();
  const clock = opts.clock ?? Date.now;
  const startedAt = Date.now();

  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.LOG_LEVEL },
    genReqId: () => `req_${Math.random().toString(36).slice(2, 12)}`,
    bodyLimit: opts.bodyLimit ?? 256 * 1024,
  });

  // BigInt-safe serialization for every JSON reply (SPEC §19).
  app.setReplySerializer((payload) => stringifyForWire(payload));

  // Security + cross-cutting plugins.
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(rateLimit, {
    max: env.API_RATE_LIMIT_MAX,
    timeWindow: env.API_RATE_LIMIT_WINDOW,
    errorResponseBuilder: () => toErrorBody('RATE_LIMITED', 'Too many requests'),
  });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  // OpenAPI docs.
  await app.register(swagger, {
    openapi: {
      info: { title: 'ChainScope API', version: '0.1.0', description: 'Real-time onchain market-intelligence for Robinhood Chain (demo mode by default).' },
      tags: [
        { name: 'system' },
        { name: 'tokens' },
        { name: 'rankings' },
        { name: 'trades' },
        { name: 'wallets' },
        { name: 'methodology' },
        { name: 'round-2' },
        { name: 'ws' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // --- services -------------------------------------------------------------
  const redis = createRedis(env.REDIS_URL);
  const redisSub = createRedis(env.REDIS_URL);
  const meta = createDemoTokenMetaProvider(env.DEMO_SEED);
  const rankings = new RankingsService(redis);
  const pubsub = new PubSub(redis);
  const tokens = new TokenReadService(prisma, meta, clock);
  const wallets = new WalletReadService(prisma, meta, clock);
  const wsHub = new WsHub({ redisSub, logger: app.log });
  const pipeline = new Pipeline({
    prisma,
    rankings,
    pubsub,
    meta,
    logger: app.log,
    snapshotIntervalMs: 10_000,
    clock,
  });
  const stream =
    env.DATA_MODE === 'demo'
      ? new DemoStreamService({
          pipeline,
          pubsub,
          logger: app.log,
          seed: env.DEMO_SEED,
          intervalMs: env.DEMO_STREAM_INTERVAL_MS,
        })
      : null;

  app.decorate('services', {
    env,
    prisma,
    redis,
    redisSub,
    meta,
    rankings,
    pubsub,
    tokens,
    wallets,
    pipeline,
    stream,
    wsHub,
    startedAt,
    clock,
  });

  // --- error + not-found handlers -------------------------------------------
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send(toErrorBody(err.code, err.message, err.details));
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) {
      return reply.status(429).send(toErrorBody('RATE_LIMITED', 'Too many requests'));
    }
    if (status === 413) {
      return reply.status(413).send(toErrorBody('PAYLOAD_TOO_LARGE', 'Request body too large'));
    }
    if (status >= 400 && status < 500) {
      return reply.status(status).send(toErrorBody('VALIDATION_ERROR', (err as Error).message));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(toErrorBody('INTERNAL_ERROR', 'Internal server error'));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(toErrorBody('NOT_FOUND', `Route ${req.method} ${req.url} not found`));
  });

  // --- routes ---------------------------------------------------------------
  await app.register(healthRoutes); // SPEC §17 literal GET /health
  await app.register(wsRoutes); // GET /ws
  await app.register(apiRoutes, { prefix: '/api/v1' }); // canonical versioned
  await app.register(apiRoutes, { prefix: '/api' }); // unversioned SPEC §17 alias

  // --- lifecycle ------------------------------------------------------------
  app.addHook('onReady', async () => {
    await wsHub.start();
  });

  app.addHook('onClose', async () => {
    if (stream) await stream.stop();
    await wsHub.close();
    redis.disconnect();
    redisSub.disconnect();
    await disconnectPrisma();
  });

  return app;
}
