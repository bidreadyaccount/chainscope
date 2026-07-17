import {
  SMART_MONEY_WEIGHTS,
  SMART_MONEY_MIN_SAMPLE_SIZE,
  SMART_MONEY_STATUS_THRESHOLDS,
  SMART_MONEY_NORMALIZATION,
  type SmartMoneyStatus,
} from '@chainscope/config';
import { clamp01, tanhNormalize, logCountConfidence, round } from '../math.js';
import type { SmartMoneyInput, SmartMoneyScore, SmartMoneyComponent } from './types.js';

/**
 * Map the composite 0..100 score to a status tier. Below the sample-size gate
 * the caller forces 'None' regardless of score.
 */
function statusForScore(score: number): SmartMoneyStatus {
  const s = SMART_MONEY_STATUS_THRESHOLDS;
  if (score >= s.confirmed) return 'Confirmed';
  if (score >= s.emerging) return 'Emerging';
  if (score >= s.candidate) return 'Candidate';
  return 'None';
}

/**
 * Smart-money scoring (SPEC §8 weights): 30% realized profitability, 20% win
 * rate, 15% entry timing, 15% consistency, 10% trade-count confidence, 10%
 * risk-adjusted return. Every component is normalized to 0..1 before weighting.
 *
 * Sample-size gate: fewer than `SMART_MONEY_MIN_SAMPLE_SIZE` closed positions →
 * score 0 and status 'None' (an unproven wallet is never "smart money").
 */
export function scoreSmartMoney(input: SmartMoneyInput): SmartMoneyScore {
  const w = SMART_MONEY_WEIGHTS;
  const norm = SMART_MONEY_NORMALIZATION;

  const closed = Math.max(0, Math.floor(input.closedPositions));
  const sampleSizeMet = closed >= SMART_MONEY_MIN_SAMPLE_SIZE;
  const winRate = closed > 0 ? clamp01(input.winningPositions / closed) : 0;

  // realized profitability: ROI mapped through tanh (0 ROI → neutral 0.5).
  const roi = input.investedUsd > 0 ? input.realizedProfitUsd / input.investedUsd : 0;
  const nProfit = tanhNormalize(roi, norm.roiScale);

  const nWin = winRate;
  const nEntry = clamp01(input.entryTimingScore ?? 0.5);
  const nConsistency = clamp01(input.consistencyScore ?? 0.5);
  const nTradeCount = logCountConfidence(closed, norm.tradeCountTarget);

  // risk-adjusted return: Sharpe-like ratio, tanh-normalized. When stddev is
  // unknown or zero we fall back to neutral 0.5 (cannot assess risk).
  const sharpe =
    input.returnStdDev && input.returnStdDev > 0 && input.avgReturnPerPosition !== undefined
      ? input.avgReturnPerPosition / input.returnStdDev
      : undefined;
  const nRisk = sharpe === undefined ? 0.5 : tanhNormalize(sharpe, norm.riskAdjustedScale);

  const rows: Array<[string, number, number]> = [
    ['realizedProfitability', nProfit, w.realizedProfitability],
    ['winRate', nWin, w.winRate],
    ['entryTiming', nEntry, w.entryTiming],
    ['consistency', nConsistency, w.consistency],
    ['tradeCountConfidence', nTradeCount, w.tradeCountConfidence],
    ['riskAdjustedReturn', nRisk, w.riskAdjustedReturn],
  ];

  const rawByKey: Record<string, number> = {
    realizedProfitability: round(roi, 4),
    winRate: round(winRate, 4),
    entryTiming: nEntry,
    consistency: nConsistency,
    tradeCountConfidence: closed,
    riskAdjustedReturn: sharpe === undefined ? 0 : round(sharpe, 4),
  };

  const components: SmartMoneyComponent[] = rows.map(([key, normalized, weight]) => ({
    key,
    raw: rawByKey[key] ?? 0,
    normalized: round(normalized, 4),
    weight,
    contribution: round(normalized * weight * 100, 4),
  }));

  const composite = components.reduce((s, c) => s + c.contribution, 0);
  const score = sampleSizeMet ? round(composite, 2) : 0;
  const status = sampleSizeMet ? statusForScore(score) : 'None';

  const reasons: string[] = [];
  if (!sampleSizeMet) {
    reasons.push(
      `Insufficient history: ${closed} closed position(s) (need ≥ ${SMART_MONEY_MIN_SAMPLE_SIZE})`,
    );
  } else {
    if (roi > 0) reasons.push(`Realized ROI ${(roi * 100).toFixed(1)}% across ${closed} positions`);
    if (winRate >= 0.5) reasons.push(`Win rate ${(winRate * 100).toFixed(0)}%`);
    if (status !== 'None') reasons.push(`Smart-money status: ${status}`);
  }

  return { score, status, sampleSizeMet, closedPositions: closed, winRate, components, reasons };
}
