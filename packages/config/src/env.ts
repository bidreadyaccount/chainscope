/**
 * Environment-variable validation (SPEC §19). Parsing is lazy so that importing
 * this module never throws at import time — call `loadEnv()` (cached) or
 * `parseEnv(source)` explicitly. Live mode enforces stricter requirements.
 */

import { z } from 'zod';

export const DATA_MODES = ['demo', 'live'] as const;
export type DataMode = (typeof DATA_MODES)[number];

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

/** Optional string that treats "" as undefined (empty .env entries). */
const optionalNonEmpty = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

const urlish = optionalNonEmpty.pipe(z.string().url().optional());

const portSchema = z.coerce.number().int().min(1).max(65_535);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATA_MODE: z.enum(DATA_MODES).default('demo'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    ROBINHOOD_RPC_URL: urlish,
    ROBINHOOD_WS_URL: urlish,
    CHAIN_CONFIRMATIONS: z.coerce.number().int().min(0).default(5),
    CHAIN_POLL_INTERVAL_MS: z.coerce.number().int().min(200).default(2_000),

    // DEX / token addresses — never invented; empty until verified.
    ROBINHOOD_UNIV2_FACTORY: optionalNonEmpty,
    ROBINHOOD_UNIV2_ROUTER: optionalNonEmpty,
    ROBINHOOD_UNIV3_FACTORY: optionalNonEmpty,
    ROBINHOOD_UNIV3_ROUTER: optionalNonEmpty,
    ROBINHOOD_UNIV3_QUOTER: optionalNonEmpty,
    ROBINHOOD_WRAPPED_NATIVE: optionalNonEmpty,
    ROBINHOOD_STABLECOINS: optionalNonEmpty,
    ETH_USD_PRICE_FEED_URL: urlish,

    API_PORT: portSchema.default(4000),
    API_HOST: z.string().default('0.0.0.0'),
    WEB_ORIGIN: z
      .string()
      .default('http://localhost:3000')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(200),
    API_RATE_LIMIT_WINDOW: z.string().default('1 minute'),

    NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    NEXT_PUBLIC_WS_URL: z.string().default('ws://localhost:4000/ws'),

    DEMO_STREAM_INTERVAL_MS: z.coerce.number().int().min(100).default(2_500),
    DEMO_SEED: z.coerce.number().int().default(1_337),

    DEBUG: booleanish.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.DATA_MODE === 'live' && !env.ROBINHOOD_RPC_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ROBINHOOD_RPC_URL'],
        message: 'ROBINHOOD_RPC_URL is required when DATA_MODE=live',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parse an explicit source (useful in tests). Throws ZodError on failure. */
export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown> = process.env): Env {
  return envSchema.parse(source);
}

/** Safe variant returning the discriminated result rather than throwing. */
export function safeParseEnv(
  source: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
): z.SafeParseReturnType<unknown, Env> {
  return envSchema.safeParse(source);
}

let cached: Env | undefined;

/** Cached process.env parse. Throws a readable error on invalid configuration. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  cached = result.data;
  return cached;
}

/** Test hook to clear the cache between cases. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function isLiveMode(env: Env): boolean {
  return env.DATA_MODE === 'live';
}

export function isDemoMode(env: Env): boolean {
  return env.DATA_MODE === 'demo';
}

/** Parse the comma-separated stablecoin list into a lowercased address array. */
export function parseStablecoins(env: Env): string[] {
  if (!env.ROBINHOOD_STABLECOINS) return [];
  return env.ROBINHOOD_STABLECOINS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
