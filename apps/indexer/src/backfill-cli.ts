/**
 * Backfill CLI: `pnpm --filter @chainscope/indexer backfill --from N --to M [--chunk C]`.
 *
 * Pages historical swap logs over the configured pools and ingests them through
 * the shared Pipeline (idempotent). Works in either DATA_MODE — in demo mode it
 * replays the DemoProvider's synthetic history, in live mode it reads the chain.
 */

import '@chainscope/api/lib/load-dotenv.js';

import { loadEnv } from '@chainscope/config';
import { pino } from 'pino';
import { buildIndexerServices } from './services.js';
import { runBackfill } from './backfill.js';

interface Args {
  from: bigint;
  to: bigint;
  chunk?: number;
}

function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        map.set(key, next);
        i++;
      } else {
        map.set(key, 'true');
      }
    }
  }
  const from = map.get('from');
  const to = map.get('to');
  if (from === undefined || to === undefined) {
    throw new Error('usage: backfill --from <block> --to <block> [--chunk <blocks>]');
  }
  const chunk = map.get('chunk');
  return {
    from: BigInt(from),
    to: BigInt(to),
    ...(chunk !== undefined ? { chunk: Number(chunk) } : {}),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const logger = pino({ level: env.LOG_LEVEL, name: 'backfill' });
  const services = await buildIndexerServices(env, logger);

  logger.info(
    { from: args.from.toString(), to: args.to.toString(), chunk: args.chunk, mode: env.DATA_MODE },
    'backfill: starting',
  );
  try {
    const result = await runBackfill(
      {
        provider: services.provider,
        runtime: services.runtime,
        pipeline: services.pipeline,
        errors: services.errors,
        logger,
      },
      {
        from: args.from,
        to: args.to,
        ...(args.chunk !== undefined ? { chunkSize: args.chunk } : {}),
      },
    );
    logger.info(
      { ...result, from: result.from.toString(), to: result.to.toString() },
      'backfill: complete',
    );
  } finally {
    await services.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('fatal: backfill failed', err);
  process.exit(1);
});
