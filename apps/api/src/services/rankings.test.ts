import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { TokenMetrics, ScoreResult } from '@chainscope/shared';
import { createRedis, type RedisClient } from '../lib/redis.js';
import { RankingsService, rankingValue } from './rankings.js';

function metrics(partial: Partial<TokenMetrics>): TokenMetrics {
  return {
    smartMoneyNetFlowUsd: 0,
    whaleNetFlowUsd: 0,
    buyVolumeUsd: 0,
    sellVolumeUsd: 0,
    netFlowUsd: 0,
    buyerConcentration: 0,
    ...partial,
  } as TokenMetrics;
}
function score(partial: Partial<ScoreResult>): ScoreResult {
  return { score: 0, riskScore: 0, ...partial } as ScoreResult;
}

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);

describe('RankingsService — Redis sorted sets', () => {
  let redis: RedisClient;
  let svc: RankingsService;

  beforeAll(() => {
    redis = createRedis(process.env.REDIS_URL!);
    svc = new RankingsService(redis);
  });
  beforeEach(async () => {
    await svc.clear();
  });
  afterAll(async () => {
    await svc.clear();
    redis.disconnect();
  });

  it('maps categories to correctly-oriented ranking values', () => {
    const m = metrics({ smartMoneyNetFlowUsd: 500, whaleNetFlowUsd: -300, netFlowUsd: -100 });
    const s = score({ score: 72, riskScore: 40 });
    expect(rankingValue('opportunity', m, s)).toBe(72);
    expect(rankingValue('smart_money_buying', m, s)).toBe(500);
    expect(rankingValue('whale_selling', m, s)).toBe(300); // -whaleNetFlow
    expect(rankingValue('strongest_distribution', m, s)).toBe(100); // -netFlow
    expect(rankingValue('highest_risk', m, s)).toBe(40);
  });

  it('writes to Redis and reads back highest-first with sequential ranks', async () => {
    await svc.updateWindow('1h', [
      { address: A, metrics: metrics({}), score: score({ score: 90 }) },
      { address: B, metrics: metrics({}), score: score({ score: 50 }) },
      { address: C, metrics: metrics({}), score: score({ score: 10 }) },
    ]);
    const out = await svc.read('opportunity', '1h', 10);
    expect(out.map((e) => e.address)).toEqual([A, B, C]);
    expect(out.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(out[0]!.value).toBe(90);
  });

  it('orders smart-money buying by net flow', async () => {
    await svc.updateWindow('15m', [
      { address: A, metrics: metrics({ smartMoneyNetFlowUsd: 100 }), score: score({}) },
      { address: B, metrics: metrics({ smartMoneyNetFlowUsd: 900 }), score: score({}) },
    ]);
    const out = await svc.read('smart_money_buying', '15m', 10);
    expect(out[0]!.address).toBe(B);
    expect(out[1]!.address).toBe(A);
  });

  it('respects the limit', async () => {
    await svc.updateWindow('1h', [
      { address: A, metrics: metrics({}), score: score({ score: 90 }) },
      { address: B, metrics: metrics({}), score: score({ score: 50 }) },
      { address: C, metrics: metrics({}), score: score({ score: 10 }) },
    ]);
    const out = await svc.read('opportunity', '1h', 2);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.address)).toEqual([A, B]);
  });
});
