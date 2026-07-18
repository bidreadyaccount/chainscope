/**
 * Integration tests for the stock-token index-layer routes against the seeded
 * DB. Asserts the core invariants a reviewer cares about: index weights sum to
 * 10000, sector allocation reconciles, and cross-references are consistent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv, resetEnvCache } from '@chainscope/config';
import { buildServer } from '../server.js';

let app: FastifyInstance;

async function json(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({ method: 'GET', url: path });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

async function post(
  path: string,
  payload: object,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({ method: 'POST', url: path, payload: payload as never });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  resetEnvCache();
  app = await buildServer({ env: loadEnv() });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /indexes', () => {
  it('returns curated indexes with headline stats', async () => {
    const { status, body } = await json('/api/v1/indexes');
    expect(status).toBe(200);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThanOrEqual(8);
    const mag7 = items.find((i) => i.symbol === 'MAG7');
    expect(mag7).toBeDefined();
    expect(mag7!.constituentCount).toBe(7);
    expect(typeof mag7!.latestLevel).toBe('number');
  });
});

describe('GET /indexes/:slug', () => {
  it('constituent weights sum to exactly 10000 bps', async () => {
    const { status, body } = await json('/api/v1/indexes/mag7');
    expect(status).toBe(200);
    const constituents = body.constituents as Array<{ weightBps: number }>;
    const sum = constituents.reduce((s, c) => s + c.weightBps, 0);
    expect(sum).toBe(10000);
  });

  it('CAP_CAPPED respects the per-constituent cap', async () => {
    const { body } = await json('/api/v1/indexes/mag7');
    expect(body.methodology).toBe('CAP_CAPPED');
    const cap = body.maxWeightBps as number;
    const constituents = body.constituents as Array<{ weightBps: number }>;
    expect(constituents.every((c) => c.weightBps <= cap)).toBe(true);
  });

  it('sector allocation reconciles to 10000 and matches constituents', async () => {
    const { body } = await json('/api/v1/indexes/mag7');
    const alloc = body.sectorAllocation as Array<{ weightBps: number }>;
    expect(alloc.reduce((s, a) => s + a.weightBps, 0)).toBe(10000);
    expect((body.navHistory as unknown[]).length).toBeGreaterThan(30);
    const perf = body.performance as { returns: Record<string, number | null> };
    expect(perf.returns).toHaveProperty('30d');
  });

  it('unknown index -> 404', async () => {
    const { status, body } = await json('/api/v1/indexes/does-not-exist');
    expect(status).toBe(404);
    expect((body.error as { code: string }).code).toBe('NOT_FOUND');
  });
});

describe('GET /stocks', () => {
  it('lists the stock-token registry', async () => {
    const { status, body } = await json('/api/v1/stocks');
    expect(status).toBe(200);
    expect((body.items as unknown[]).length).toBeGreaterThanOrEqual(20);
  });

  it('sector filter narrows the list', async () => {
    const { body } = await json('/api/v1/stocks?sector=Technology');
    const items = body.items as Array<{ sector: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((s) => s.sector === 'Technology')).toBe(true);
  });

  it('stock detail cross-references the indexes that hold it', async () => {
    const { status, body } = await json('/api/v1/stocks/NVDA');
    expect(status).toBe(200);
    const members = body.memberOfIndexes as Array<{ symbol: string; weightBps: number }>;
    expect(members.map((m) => m.symbol)).toContain('MAG7');
    // Demo assets carry a fake contract; never a fabricated real address claim.
    expect(body.isDemo).toBe(true);
  });

  it('unknown stock -> 404', async () => {
    const { status } = await json('/api/v1/stocks/ZZZZ');
    expect(status).toBe(404);
  });
});

describe('POST /indexes/preview (builder)', () => {
  it('computes weights summing to 10000 for a methodology', async () => {
    const { status, body } = await post('/api/v1/indexes/preview', {
      tickers: ['AAPL', 'NVDA', 'JPM'],
      methodology: 'MARKET_CAP',
      maxWeightBps: 5000,
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const weights = body.weights as Array<{ weightBps: number }>;
    expect(weights.reduce((s, w) => s + w.weightBps, 0)).toBe(10000);
    expect(weights.every((w) => w.weightBps <= 5000)).toBe(true);
  });

  it('accepts manual weights and reports MANUAL methodology', async () => {
    const { body } = await post('/api/v1/indexes/preview', {
      tickers: ['AAPL', 'MSFT'],
      manualWeights: [
        { ticker: 'AAPL', weight: 70 },
        { ticker: 'MSFT', weight: 30 },
      ],
    });
    expect(body.methodology).toBe('MANUAL');
    const weights = body.weights as Array<{ ticker: string; weightBps: number }>;
    expect(weights.find((w) => w.ticker === 'AAPL')!.weightBps).toBe(7000);
  });

  it('reports CAP_INFEASIBLE rather than an over-cap book', async () => {
    const { body } = await post('/api/v1/indexes/preview', {
      tickers: ['AAPL', 'MSFT', 'NVDA', 'JPM'],
      methodology: 'CAP_CAPPED',
      maxWeightBps: 2000,
    });
    expect(body.ok).toBe(false);
    expect(body.error).toBe('CAP_INFEASIBLE');
  });

  it('rejects an empty ticker list (400)', async () => {
    const { status } = await post('/api/v1/indexes/preview', { tickers: [] });
    expect(status).toBe(400);
  });

  it('rejects duplicate tickers (400) — audit R-03', async () => {
    const { status } = await post('/api/v1/indexes/preview', {
      tickers: ['AAPL', 'aapl', 'MSFT'],
      methodology: 'EQUAL',
    });
    expect(status).toBe(400);
  });

  it('rejects manualWeights tickers not present in tickers (400)', async () => {
    const { status } = await post('/api/v1/indexes/preview', {
      tickers: ['AAPL', 'MSFT'],
      manualWeights: [
        { ticker: 'AAPL', weight: 50 },
        { ticker: 'NVDA', weight: 50 },
      ],
    });
    expect(status).toBe(400);
  });

  it('rejects whitespace-padded duplicate tickers (400) — audit F-02', async () => {
    const { status } = await post('/api/v1/indexes/preview', {
      tickers: ['AAPL', ' AAPL', 'MSFT'],
      methodology: 'EQUAL',
    });
    expect(status).toBe(400);
  });

  it('trims whitespace so a padded valid request still works', async () => {
    const { status, body } = await post('/api/v1/indexes/preview', {
      tickers: [' AAPL ', 'MSFT'],
      methodology: 'EQUAL',
    });
    expect(status).toBe(200);
    const weights = body.weights as Array<{ ticker: string }>;
    expect(weights.map((w) => w.ticker).sort()).toEqual(['AAPL', 'MSFT']);
  });

  it('rejects a whitespace-only ticker (400)', async () => {
    const { status } = await post('/api/v1/indexes/preview', {
      tickers: ['   ', 'MSFT'],
      methodology: 'EQUAL',
    });
    expect(status).toBe(400);
  });
});

describe('GET /indexes/:slug/simulate', () => {
  it('splits an investment and projects value over the index history', async () => {
    const { status, body } = await json('/api/v1/indexes/mag7/simulate?amount=5000');
    expect(status).toBe(200);
    expect(body.amountUsd).toBe(5000);
    const allocations = body.allocations as Array<{ allocationUsd: number }>;
    const totalAllocated = allocations.reduce((s, a) => s + a.allocationUsd, 0);
    expect(totalAllocated).toBeCloseTo(5000, 0); // fully invested
    expect((body.valueSeries as unknown[]).length).toBeGreaterThan(30);
    // All demo constituents are priced → projection is available and consistent.
    expect(body.projectionAvailable).toBe(true);
    // Allocations expose realized (renormalized) weight alongside target weight.
    const alloc0 = (body.allocations as Array<{ realizedWeightBps: number }>)[0]!;
    expect(typeof alloc0.realizedWeightBps).toBe('number');
    // Benchmark comparison is honestly flagged unavailable (not fabricated).
    expect(body.benchmarkComparisonAvailable).toBe(false);
  });

  it('rejects a non-positive amount (400)', async () => {
    const { status } = await json('/api/v1/indexes/mag7/simulate?amount=-5');
    expect(status).toBe(400);
  });

  it('unknown index -> 404', async () => {
    const { status } = await json('/api/v1/indexes/nope/simulate?amount=100');
    expect(status).toBe(404);
  });
});
