/**
 * Minimal zero-dependency .env loader. Walks up from the current working
 * directory to the repo root, reads the first `.env` it finds, and populates
 * any *missing* process.env keys (never overrides an already-set var). Imported
 * first in the entrypoint so `@chainscope/database` (which reads
 * process.env.DATABASE_URL at module-eval time) sees the values.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function findEnvFile(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function parseAndApply(path: string): void {
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const envFile = findEnvFile(process.cwd());
if (envFile) parseAndApply(envFile);
