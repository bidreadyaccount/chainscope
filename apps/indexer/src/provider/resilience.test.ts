/**
 * Resilience tests: circuit-breaker state transitions with an injected clock,
 * jittered-backoff bounds, retry loop behaviour with fake sleep, and backfill
 * chunk-size bounding.
 */
import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';
import { computeBackoffDelay, withRetry } from './retry.js';
import { boundedChunkSize } from '../backfill.js';

describe('CircuitBreaker', () => {
  function mkBreaker(nowRef: { t: number }) {
    return new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => nowRef.t });
  }

  it('stays closed under the failure threshold and resets on success', () => {
    const now = { t: 0 };
    const cb = mkBreaker(now);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.snapshot().state).toBe('closed');
    cb.recordSuccess();
    expect(cb.snapshot().consecutiveFailures).toBe(0);
  });

  it('opens at the threshold and fast-rejects until cooldown', () => {
    const now = { t: 0 };
    const cb = mkBreaker(now);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.snapshot().state).toBe('open');
    expect(cb.canRequest()).toBe(false);
    now.t = 999;
    expect(cb.canRequest()).toBe(false);
  });

  it('half-opens after cooldown, admits ONE probe, closes on success', () => {
    const now = { t: 0 };
    const cb = mkBreaker(now);
    for (let i = 0; i < 3; i++) cb.recordFailure();
    now.t = 1000;
    expect(cb.canRequest()).toBe(true); // the probe
    expect(cb.snapshot().state).toBe('half_open');
    expect(cb.canRequest()).toBe(false); // only one probe at a time
    cb.recordSuccess();
    expect(cb.snapshot().state).toBe('closed');
    expect(cb.canRequest()).toBe(true);
  });

  it('re-opens immediately when the half-open probe fails', () => {
    const now = { t: 0 };
    const cb = mkBreaker(now);
    for (let i = 0; i < 3; i++) cb.recordFailure();
    now.t = 1500;
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.snapshot().state).toBe('open');
    expect(cb.canRequest()).toBe(false);
  });
});

describe('computeBackoffDelay', () => {
  const opts = { baseMs: 200, maxMs: 8000 };

  it('grows exponentially and is capped at maxMs (random=1 upper bound)', () => {
    const upper = () => 0.999999;
    const d0 = computeBackoffDelay(0, opts, upper); // < 200
    const d1 = computeBackoffDelay(1, opts, upper); // < 400
    const d5 = computeBackoffDelay(5, opts, upper); // < 6400
    const d10 = computeBackoffDelay(10, opts, upper); // capped < 8000
    expect(d0).toBeLessThan(200);
    expect(d1).toBeGreaterThanOrEqual(d0 / 2 - 1);
    expect(d1).toBeLessThan(400);
    expect(d5).toBeLessThan(6400);
    expect(d10).toBeLessThan(8000);
  });

  it('full jitter: random=0 yields zero delay', () => {
    expect(computeBackoffDelay(4, opts, () => 0)).toBe(0);
  });
});

describe('withRetry', () => {
  it('retries with backoff sleeps then succeeds', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('flaky');
        return 'ok';
      },
      {
        retries: 4,
        baseMs: 100,
        maxMs: 1000,
        random: () => 0.5,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([50, 100]); // 0.5 * 100*2^0, 0.5 * 100*2^1
  });

  it('re-throws the last error when retries are exhausted', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`fail-${calls}`);
        },
        { retries: 2, sleep: async () => {}, random: () => 0 },
      ),
    ).rejects.toThrow('fail-3');
    expect(calls).toBe(3); // first attempt + 2 retries
  });

  it('does not retry when shouldRetry rejects the error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('fatal');
        },
        { retries: 5, shouldRetry: () => false, sleep: async () => {} },
      ),
    ).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });
});

describe('boundedChunkSize', () => {
  it('defaults to 2000 and clamps into [1, 50000]', () => {
    expect(boundedChunkSize(undefined)).toBe(2000n);
    expect(boundedChunkSize(0)).toBe(2000n);
    expect(boundedChunkSize(-5)).toBe(2000n);
    expect(boundedChunkSize(1)).toBe(1n);
    expect(boundedChunkSize(999999)).toBe(50000n);
    expect(boundedChunkSize(1234.9)).toBe(1234n);
  });
});
