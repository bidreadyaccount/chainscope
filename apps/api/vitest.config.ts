import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Load repo-root .env into the test process (no dotenv dependency). Local dev
// datastore values only — never secrets.
function rootEnv(): Record<string, string> {
  const path = join(__dirname, '..', '..', '.env');
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { NODE_ENV: 'test', DATA_MODE: 'demo', ...rootEnv() },
    // Shared Postgres/Redis: run this project's files sequentially to avoid
    // cross-file interference on the same keys/rows.
    fileParallelism: false,
    hookTimeout: 40_000,
    testTimeout: 40_000,
  },
});
