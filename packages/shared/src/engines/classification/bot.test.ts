import { describe, it, expect } from 'vitest';
import { BOT_INDICATORS, BOT_INDICATOR_WEIGHTS } from '@chainscope/config';
import { scoreBotProbability } from './bot.js';
import type { WalletActivitySummary } from './types.js';

function w(overrides: Partial<WalletActivitySummary> = {}): WalletActivitySummary {
  return {
    address: '0xbot',
    portfolioValueUsd: 10_000,
    tradeSizesUsd: [500],
    firstSeenDaysAgo: 30,
    txCount: 1000,
    ...overrides,
  };
}

describe('scoreBotProbability — indicators (SPEC §8)', () => {
  it('no timing signals → probability 0, no reasons', () => {
    const r = scoreBotProbability(w());
    expect(r.probability).toBe(0);
    expect(r.reasons).toHaveLength(0);
    expect(r.indicators.every((i) => !i.triggered)).toBe(true);
  });

  it('launch-block purchase fires its indicator', () => {
    const r = scoreBotProbability(w({ timing: { boughtInLaunchBlock: true } }));
    const ind = r.indicators.find((i) => i.key === 'launchBlockPurchase')!;
    expect(ind.triggered).toBe(true);
    expect(r.probability).toBe(BOT_INDICATOR_WEIGHTS.launchBlockPurchase);
  });

  it('reaction time exactly at threshold fires (<=)', () => {
    const r = scoreBotProbability(
      w({ timing: { minReactionTimeMs: BOT_INDICATORS.maxReactionTimeMs } }),
    );
    expect(r.indicators.find((i) => i.key === 'extremelyShortReaction')!.triggered).toBe(true);
  });

  it('reaction time 1ms above threshold does NOT fire', () => {
    const r = scoreBotProbability(
      w({ timing: { minReactionTimeMs: BOT_INDICATORS.maxReactionTimeMs + 1 } }),
    );
    expect(r.indicators.find((i) => i.key === 'extremelyShortReaction')!.triggered).toBe(false);
  });

  it('repeated identical amounts at threshold count fires', () => {
    const r = scoreBotProbability(
      w({ timing: { identicalAmountRepeats: BOT_INDICATORS.repeatedAmountCount } }),
    );
    expect(r.indicators.find((i) => i.key === 'repeatedIdenticalAmounts')!.triggered).toBe(true);
  });

  it('abnormal tx frequency at threshold fires', () => {
    const r = scoreBotProbability(w({ timing: { txPerHourPeak: BOT_INDICATORS.abnormalTxPerHour } }));
    expect(r.indicators.find((i) => i.key === 'abnormalTxFrequency')!.triggered).toBe(true);
  });

  it('cluster funding at threshold count fires', () => {
    const r = scoreBotProbability(w({ fundingSourceSharedCount: BOT_INDICATORS.clusterFundingWalletCount }));
    expect(r.indicators.find((i) => i.key === 'clusterFunding')!.triggered).toBe(true);
  });

  it('very short holding at threshold fires', () => {
    const r = scoreBotProbability(w({ timing: { shortestHoldSeconds: BOT_INDICATORS.veryShortHoldSeconds } }));
    expect(r.indicators.find((i) => i.key === 'veryShortHolding')!.triggered).toBe(true);
  });

  it('probability is the clamped sum of fired weights, capped at 100', () => {
    const r = scoreBotProbability(
      w({
        fundingSourceSharedCount: 10,
        timing: {
          boughtInLaunchBlock: true,
          minReactionTimeMs: 100,
          identicalAmountRepeats: 20,
          txPerHourPeak: 100,
          repetitiveRouterTokenPattern: true,
          shortestHoldSeconds: 5,
        },
      }),
    );
    // All seven indicators fire; raw sum > 100 → clamped.
    expect(r.indicators.every((i) => i.triggered)).toBe(true);
    expect(r.probability).toBe(100);
  });

  it('reasons are hedged ("Possible bot")', () => {
    const r = scoreBotProbability(w({ timing: { boughtInLaunchBlock: true } }));
    expect(r.reasons.every((x) => x.startsWith('Possible bot'))).toBe(true);
  });
});
