import './lib/load-dotenv.js';

import { spawnSync } from 'node:child_process';
import { loadEnv } from '@chainscope/config';
import { buildServer } from './server.js';

async function ensureSeedData(app: Awaited<ReturnType<typeof buildServer>>): Promise<boolean> {
  const count = await app.services.prisma.token.count();
  if (count > 0) return true;
  app.log.warn('demo mode: no seed data found — running `pnpm db:seed`');
  const res = spawnSync('pnpm', ['--filter', '@chainscope/database', 'run', 'seed'], {
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    app.log.error('auto-seed failed — run `pnpm db:seed` manually, then restart');
    return false;
  }
  return (await app.services.prisma.token.count()) > 0;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer({ env });

  if (env.DATA_MODE === 'demo') {
    const seeded = await ensureSeedData(app);
    if (seeded) {
      const t0 = Date.now();
      const warm = await app.services.pipeline.warmup();
      app.log.info({ ...warm, ms: Date.now() - t0 }, 'pipeline warmup complete');
      app.services.stream?.start();
    }
  }

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  app.log.info(
    `ChainScope API listening on http://${env.API_HOST}:${env.API_PORT} (docs at /docs)`,
  );

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'graceful shutdown');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('fatal: failed to start API', err);
  process.exit(1);
});
