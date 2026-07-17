import { describe, it, expect } from 'vitest';
import { SMART_MONEY_MIN_SAMPLE_SIZE, SMART_MONEY_STATUS_THRESHOLDS } from '@chainscope/config';
import { scoreSmartMoney } from './smart-money.js';
import type { SmartMoneyInput } from './types.js';

function strong(overrides: Partial<SmartMoneyInput> = {}): SmartMoneyInput {
  return {
    realizedProfitUsd: 10_000,
    investedUsd: 10_000,
    closedPositions: 10,
    winningPositions: 9,
    losingPositions: 1,
    entryTimingScore: 0.9,
    consistencyScore: 0.9,
    avgReturnPerPosition: 0.5,
    returnStdDev: 0.25,
    ...overrides,
  };
}

describe('scoreSmartMoney — sample-size gate (SPEC §8)', () => {
  it(`fewer than ${SMART_MONEY_MIN_SAMPLE_SIZE} closed positions → score 0, status None`, () => {
    const r = scoreSmartMoney(strong({ closedPositions: SMART_MONEY_MIN_SAMPLE_SIZE - 1, winningPositions: 3 }));
    expect(r.sampleSizeMet).toBe(false);
    expect(r.score).toBe(0);
    expect(r.status).toBe('None');
    expect(r.reasons.some((x) => x.includes('Insufficient history'))).toBe(true);
  });

  it(`exactly ${SMART_MONEY_MIN_SAMPLE_SIZE} closed positions meets the gate`, () => {
    const r = scoreSmartMoney(strong({ closedPositions: SMART_MONEY_MIN_SAMPLE_SIZE, winningPositions: 5 }));
    expect(r.sampleSizeMet).toBe(true);
    expect(r.score).toBeGreaterThan(0);
  });
});

describe('scoreSmartMoney — status tiers', () => {
  it('a strong wallet is Confirmed (>= confirmed threshold)', () => {
    const r = scoreSmartMoney(strong());
    expect(r.score).toBeGreaterThanOrEqual(SMART_MONEY_STATUS_THRESHOLDS.confirmed);
    expect(r.status).toBe('Confirmed');
  });

  it('a break-even, coin-flip wallet lands below Confirmed', () => {
    const r = scoreSmartMoney(
      strong({
        realizedProfitUsd: 0,
        winningPositions: 5,
        losingPositions: 5,
        entryTimingScore: 0.5,
        consistencyScore: 0.5,
        avgReturnPerPosition: 0,
        returnStdDev: 0.25,
      }),
    );
    expect(r.score).toBeLessThan(SMART_MONEY_STATUS_THRESHOLDS.confirmed);
  });

  it('status ladder matches the composite score', () => {
    const r = scoreSmartMoney(strong());
    const s = r.score;
    const expected =
      s >= SMART_MONEY_STATUS_THRESHOLDS.confirmed
        ? 'Confirmed'
        : s >= SMART_MONEY_STATUS_THRESHOLDS.emerging
          ? 'Emerging'
          : s >= SMART_MONEY_STATUS_THRESHOLDS.candidate
            ? 'Candidate'
            : 'None';
    expect(r.status).toBe(expected);
  });
});

describe('scoreSmartMoney — component math', () => {
  it('win rate = winning / closed', () => {
    const r = scoreSmartMoney(strong({ closedPositions: 8, winningPositions: 6, losingPositions: 2 }));
    expect(r.winRate).toBeCloseTo(0.75, 10);
  });

  it('component contributions sum to the composite score (pre-round)', () => {
    const r = scoreSmartMoney(strong());
    const sum = r.components.reduce((a, c) => a + c.contribution, 0);
    expect(sum).toBeCloseTo(r.score, 2);
  });

  it('weights match SPEC §8 (30/20/15/15/10/10)', () => {
    const r = scoreSmartMoney(strong());
    const byKey = Object.fromEntries(r.components.map((c) => [c.key, c.weight]));
    expect(byKey.realizedProfitability).toBe(0.3);
    expect(byKey.winRate).toBe(0.2);
    expect(byKey.entryTiming).toBe(0.15);
    expect(byKey.consistency).toBe(0.15);
    expect(byKey.tradeCountConfidence).toBe(0.1);
    expect(byKey.riskAdjustedReturn).toBe(0.1);
  });

  it('unknown risk stddev falls back to a neutral 0.5 normalized value', () => {
    const r = scoreSmartMoney(strong({ returnStdDev: 0, avgReturnPerPosition: undefined }));
    const risk = r.components.find((c) => c.key === 'riskAdjustedReturn')!;
    expect(risk.normalized).toBeCloseTo(0.5, 10);
  });

  it('zero invested → neutral profitability (no divide-by-zero)', () => {
    const r = scoreSmartMoney(strong({ investedUsd: 0, realizedProfitUsd: 0 }));
    const p = r.components.find((c) => c.key === 'realizedProfitability')!;
    expect(p.normalized).toBeCloseTo(0.5, 10);
  });
});
