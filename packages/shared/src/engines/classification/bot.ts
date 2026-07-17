import { BOT_INDICATORS, BOT_INDICATOR_WEIGHTS } from '@chainscope/config';
import { clamp } from '../math.js';
import type { WalletActivitySummary, BotScore, BotIndicatorResult } from './types.js';

/**
 * Explainable bot-probability scoring (SPEC §8). Each indicator fires against a
 * configured threshold and contributes its configured weight; the probability
 * is the clamped sum. Wording stays hedged ("Possible bot") per guardrails —
 * this never asserts a wallet *is* a bot.
 */
export function scoreBotProbability(w: WalletActivitySummary): BotScore {
  const t = w.timing ?? {};
  const ind = BOT_INDICATORS;
  const wt = BOT_INDICATOR_WEIGHTS;

  const indicators: BotIndicatorResult[] = [
    {
      key: 'launchBlockPurchase',
      triggered: t.boughtInLaunchBlock === true,
      weight: wt.launchBlockPurchase,
      detail: 'Purchased in the token launch block',
    },
    {
      key: 'extremelyShortReaction',
      triggered: t.minReactionTimeMs !== undefined && t.minReactionTimeMs <= ind.maxReactionTimeMs,
      weight: wt.extremelyShortReaction,
      detail: `Reaction time ≤ ${ind.maxReactionTimeMs}ms`,
    },
    {
      key: 'repeatedIdenticalAmounts',
      triggered:
        t.identicalAmountRepeats !== undefined &&
        t.identicalAmountRepeats >= ind.repeatedAmountCount,
      weight: wt.repeatedIdenticalAmounts,
      detail: `≥ ${ind.repeatedAmountCount} near-identical trade sizes`,
    },
    {
      key: 'abnormalTxFrequency',
      triggered: t.txPerHourPeak !== undefined && t.txPerHourPeak >= ind.abnormalTxPerHour,
      weight: wt.abnormalTxFrequency,
      detail: `≥ ${ind.abnormalTxPerHour} trades/hour at peak`,
    },
    {
      key: 'repetitiveRouterTokenPattern',
      triggered: t.repetitiveRouterTokenPattern === true,
      weight: wt.repetitiveRouterTokenPattern,
      detail: 'Repetitive router/token interaction pattern',
    },
    {
      key: 'clusterFunding',
      triggered:
        w.fundingSourceSharedCount !== undefined &&
        w.fundingSourceSharedCount >= ind.clusterFundingWalletCount,
      weight: wt.clusterFunding,
      detail: `Shares a funding source with ≥ ${ind.clusterFundingWalletCount} wallets`,
    },
    {
      key: 'veryShortHolding',
      triggered:
        t.shortestHoldSeconds !== undefined && t.shortestHoldSeconds <= ind.veryShortHoldSeconds,
      weight: wt.veryShortHolding,
      detail: `Holding period ≤ ${ind.veryShortHoldSeconds}s`,
    },
  ];

  const probability = clamp(
    indicators.reduce((sum, i) => sum + (i.triggered ? i.weight : 0), 0),
    0,
    100,
  );

  const reasons = indicators
    .filter((i) => i.triggered)
    .map((i) => `Possible bot: ${i.detail.toLowerCase()}`);

  return { probability, indicators, reasons };
}
