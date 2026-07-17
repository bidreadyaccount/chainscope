/**
 * Indexer entrypoint (BUILD_BRIEF Phase 4).
 *
 * DATA_MODE=live  → the indexer is the producer: it subscribes to Robinhood
 *                   Chain heads, catches up to head−CONFIRMATIONS, decodes
 *                   registered-pool swaps, and ingests them through the shared
 *                   Pipeline (positions, metrics, scores, rankings, WS publish).
 *                   The API stops its demo stream when DATA_MODE=live.
 *
 * DATA_MODE=demo  → the overall system's producer is the API's demo stream (see
 *                   apps/api). Running THIS process in demo mode replays the
 *                   deterministic DemoProvider once through the full indexer path
 *                   (proving block→log→decode→normalize→ingest end-to-end) and
 *                   then idles, publishing health. It is primarily a live-path
 *                   proof; leave the API's stream as the demo producer.
 *
 * When live mode is configured but NO pools are registered (no verified DEX
 * addresses supplied), the engine logs that live decoding is inactive and simply
 * tracks the chain head — it never invents addresses.
 */

import '@chainscope/api/lib/load-dotenv.js';

import { loadEnv } from '@chainscope/config';
import { pino } from 'pino';
import { buildIndexerServices } from './services.js';
import { IndexerEngine } from './engine.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = pino({ level: env.LOG_LEVEL, name: 'indexer' });
  const services = await buildIndexerServices(env, logger);
  const { runtime, provider, checkpoint, pipeline, pubsub, errors } = services;

  if (runtime.registry.isEmpty()) {
    logger.warn(
      { mode: env.DATA_MODE },
      runtime.isDemo
        ? 'indexer: demo registry empty (unexpected) — check demo fixtures'
        : 'indexer: no pools configured — LIVE DECODING INACTIVE. Populate LiquidityPool/Dex with verified addresses. Tracking head only.',
    );
  } else {
    logger.info(
      { mode: env.DATA_MODE, pools: runtime.registry.size },
      'indexer: adapter registry built',
    );
  }

  const engine = new IndexerEngine({
    provider,
    runtime,
    checkpoint,
    pipeline,
    pubsub,
    errors,
    logger,
    confirmations: env.CHAIN_CONFIRMATIONS,
  });

  let stopEngine: (() => void) | undefined;

  if (runtime.isDemo) {
    const result = await engine.catchUp();
    await engine.publishHealth();
    logger.info(
      { ...result, head: result.head.toString(), target: result.target.toString() },
      'indexer(demo): bounded catch-up complete — idling (API demo stream is the producer)',
    );
    // Keep publishing health periodically; the demo provider has no new heads.
    stopEngine = engine.start({ healthIntervalMs: env.DEMO_STREAM_INTERVAL_MS });
  } else {
    stopEngine = engine.start({ healthIntervalMs: 10_000 });
    logger.info('indexer(live): head subscription active');
  }

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'indexer: graceful shutdown');
    try {
      if (stopEngine) stopEngine();
      await services.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'indexer: error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('fatal: failed to start indexer', err);
  process.exit(1);
});
