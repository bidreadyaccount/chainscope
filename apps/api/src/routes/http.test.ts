import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv, resetEnvCache } from '@chainscope/config';
import { serializedTradeSchema } from '@chainscope/shared';
import { buildServer } from '../server.js';

let app: FastifyInstance;
let firstToken: string;
let firstWallet: string;

async function json(
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await app.inject({ method, url: path });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  resetEnvCache();
  app = await buildServer({ env: loadEnv() });
  await app.ready();
  // Populate Redis rankings + positions so /rankings and /holders have data.
  await app.services.pipeline.warmup();

  const tokens = await app.services.prisma.token.findMany({ take: 1, select: { address: true } });
  firstToken = tokens[0]!.address;
  const wallets = await app.services.prisma.wallet.findMany({ take: 1, select: { address: true } });
  firstWallet = wallets[0]!.address;
});

afterAll(async () => {
  await app.close();
});

describe('GET system endpoints', () => {
  it('GET /health -> 200 ok', async () => {
    const { status, body } = await json('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('GET /api/v1/status -> 200 with datastore health', async () => {
    const { status, body } = await json('/api/v1/status');
    expect(status).toBe(200);
    expect(body.mode).toBe('demo');
    const datastores = body.datastores as {
      database: { status: string };
      redis: { status: string };
    };
    expect(datastores.database.status).toBe('ok');
    expect(datastores.redis.status).toBe('ok');
  });

  it('GET /api/status (unversioned alias) -> 200', async () => {
    const { status } = await json('/api/status');
    expect(status).toBe(200);
  });

  it('GET /api/v1/methodology -> 200 structured', async () => {
    const { status, body } = await json('/api/v1/methodology');
    expect(status).toBe(200);
    expect(Array.isArray(body.walletClasses)).toBe(true);
    expect((body.opportunityScore as { weights: unknown }).weights).toBeTruthy();
  });
});

describe('GET token endpoints', () => {
  it('GET /api/v1/tokens?window=1h -> 200 ranked list', async () => {
    const { status, body } = await json('/api/v1/tokens?window=1h');
    expect(status).toBe(200);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.rank).toBe(1);
    for (const it of items) {
      expect(typeof it.address).toBe('string');
      expect(typeof it.opportunityScore).toBe('number');
      expect(typeof it.signal).toBe('string');
    }
  });

  it('rejects a bad window with 400 VALIDATION_ERROR', async () => {
    const { status, body } = await json('/api/v1/tokens?window=2h');
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('rejects a bad sort column with 400', async () => {
    const { status, body } = await json('/api/v1/tokens?sort=notacolumn');
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/v1/tokens/:address -> 200 detail', async () => {
    const { status, body } = await json(`/api/v1/tokens/${firstToken}`);
    expect(status).toBe(200);
    expect(body.address).toBe(firstToken);
  });

  it('GET /api/v1/tokens/:address/score -> 200 with full breakdown + explanations', async () => {
    const { status, body } = await json(`/api/v1/tokens/${firstToken}/score?window=1h`);
    expect(status).toBe(200);
    const components = body.components as unknown[];
    expect(components.length).toBe(8);
    expect(Array.isArray(body.penalties)).toBe(true);
    const ex = body.explanations as { positiveFactors: unknown[]; riskFactors: unknown[] };
    expect(Array.isArray(ex.positiveFactors)).toBe(true);
    expect(Array.isArray(ex.riskFactors)).toBe(true);
    expect(typeof body.signal).toBe('string');
  });

  it('GET /api/v1/tokens/:address/metrics -> 200', async () => {
    const { status, body } = await json(`/api/v1/tokens/${firstToken}/metrics`);
    expect(status).toBe(200);
    expect((body.metrics as Record<string, unknown>).buyVolumeUsd).toBeTypeOf('number');
  });

  it('GET /api/v1/tokens/:address/trades -> 200 with serialized trades', async () => {
    const { status, body } = await json(`/api/v1/tokens/${firstToken}/trades?limit=5`);
    expect(status).toBe(200);
    const items = body.items as unknown[];
    if (items.length > 0) {
      expect(() => serializedTradeSchema.parse(items[0])).not.toThrow();
    }
  });

  it('GET /api/v1/tokens/:address/holders -> 200 with available flag', async () => {
    const { status, body } = await json(`/api/v1/tokens/${firstToken}/holders`);
    expect(status).toBe(200);
    expect(typeof body.available).toBe('boolean');
    expect(Array.isArray(body.holders)).toBe(true);
  });

  it('unknown but valid token address -> 404', async () => {
    const { status, body } = await json(`/api/v1/tokens/0x${'0'.repeat(40)}`);
    expect(status).toBe(404);
    expect((body.error as { code: string }).code).toBe('NOT_FOUND');
  });

  it('malformed token address -> 400', async () => {
    const { status } = await json('/api/v1/tokens/not-an-address');
    expect(status).toBe(400);
  });
});

describe('GET rankings + trades', () => {
  it('GET /api/v1/rankings?type=opportunity&window=1h -> 200 non-empty from Redis', async () => {
    const { status, body } = await json('/api/v1/rankings?type=opportunity&window=1h');
    expect(status).toBe(200);
    const items = body.items as Array<{ rank: number }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.rank).toBe(1);
  });

  it('GET /api/v1/rankings with category alias works', async () => {
    const { status, body } = await json('/api/v1/rankings?category=highest_risk&window=24h');
    expect(status).toBe(200);
    expect(body.category).toBe('highest_risk');
  });

  it('rejects a bad ranking category -> 400', async () => {
    const { status } = await json('/api/v1/rankings?type=bogus');
    expect(status).toBe(400);
  });

  it('GET /api/v1/trades/live -> 200', async () => {
    const { status, body } = await json('/api/v1/trades/live?limit=10');
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
  });
});

describe('GET wallet endpoints', () => {
  it('GET /api/v1/wallets/:address -> 200 with labels + bot probability', async () => {
    const { status, body } = await json(`/api/v1/wallets/${firstWallet}`);
    expect(status).toBe(200);
    expect(typeof body.primaryClass).toBe('string');
    expect(Array.isArray(body.labels)).toBe(true);
    expect(typeof body.botProbability).toBe('number');
  });

  it('GET /api/v1/wallets/:address/positions -> 200', async () => {
    const { status, body } = await json(`/api/v1/wallets/${firstWallet}/positions`);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('GET /api/v1/wallets/:address/relationships -> 200', async () => {
    const { status, body } = await json(`/api/v1/wallets/${firstWallet}/relationships`);
    expect(status).toBe(200);
    expect(body.address).toBe(firstWallet);
  });

  it('GET /api/v1/wallets/:address/trades -> 200', async () => {
    const { status, body } = await json(`/api/v1/wallets/${firstWallet}/trades?limit=5`);
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('unknown wallet -> 404', async () => {
    const { status } = await json(`/api/v1/wallets/0x${'1'.repeat(40)}`);
    expect(status).toBe(404);
  });
});

describe('round-2 write endpoints -> 501', () => {
  it('POST /api/v1/watchlists -> 501 NOT_IMPLEMENTED', async () => {
    const { status, body } = await json('/api/v1/watchlists', 'POST');
    expect(status).toBe(501);
    expect((body.error as { code: string }).code).toBe('NOT_IMPLEMENTED');
    expect((body.error as { message: string }).message).toMatch(/round 2/i);
  });

  it('POST /api/v1/alerts -> 501', async () => {
    const { status, body } = await json('/api/v1/alerts', 'POST');
    expect(status).toBe(501);
    expect((body.error as { code: string }).code).toBe('NOT_IMPLEMENTED');
  });
});

describe('unknown route', () => {
  it('GET /api/v1/nope -> 404 structured', async () => {
    const { status, body } = await json('/api/v1/nope');
    expect(status).toBe(404);
    expect((body.error as { code: string }).code).toBe('NOT_FOUND');
  });
});
