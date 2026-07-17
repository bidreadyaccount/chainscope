import {
  OPPORTUNITY_WEIGHTS,
  OPPORTUNITY_NORMALIZATION,
  RISK_PENALTIES,
  RISK_TRIGGERS,
  MIN_DISPLAYABLE_PRICE_CONFIDENCE,
  signalLabel,
} from '@chainscope/config';
import { clamp, clamp01, tanhNormalize, round } from '../math.js';
import type {
  OpportunityInput,
  ComponentBreakdown,
  PenaltyBreakdown,
  ScoreResult,
} from './types.js';

/**
 * Opportunity + risk scoring (SPEC §12). Each component is normalized to [0,1]
 * with a documented deterministic mapping (bounded tanh for signed magnitudes,
 * linear for already-bounded [-1,1] inputs), weighted per the §12 weights,
 * summed to a 0..100 base, then reduced by triggered risk penalties and clamped
 * to [0,100]. A separate 0..100 risk score is returned.
 *
 * Contribution identity (tested): sum(component.contribution) === baseScore, and
 * baseScore − totalPenalty === scorePreClamp.
 */
export function computeOpportunityScore(input: OpportunityInput): ScoreResult {
  const c = input.components;
  const w = OPPORTUNITY_WEIGHTS;
  const n = OPPORTUNITY_NORMALIZATION;

  // Normalize each component to [0,1].
  const norm = {
    smartMoneyNetFlow: tanhNormalize(c.smartMoneyNetFlowUsd, n.netFlowUsdScale),
    whaleNetFlow: tanhNormalize(c.whaleNetFlowUsd, n.netFlowUsdScale),
    uniqueBuyerGrowth: tanhNormalize(c.uniqueBuyerGrowth, n.uniqueBuyerGrowthScale),
    // buy/sell imbalance is already in [-1,1] → map linearly to [0,1].
    buySellImbalance: clamp01((clamp(c.buySellImbalance, -1, 1) + 1) / 2),
    liquidityGrowth: tanhNormalize(c.liquidityGrowthPct, n.liquidityGrowthScale),
    buyerQualityImprovement: tanhNormalize(c.buyerQualityImprovement, n.buyerQualityScale),
    volumeAcceleration: tanhNormalize(c.volumeAcceleration, n.volumeAccelerationScale),
    priceConfirmation: tanhNormalize(c.priceConfirmation, n.priceConfirmationScale),
  };

  const rows: Array<[string, number, number]> = [
    ['smartMoneyNetFlow', norm.smartMoneyNetFlow, w.smartMoneyNetFlow],
    ['whaleNetFlow', norm.whaleNetFlow, w.whaleNetFlow],
    ['uniqueBuyerGrowth', norm.uniqueBuyerGrowth, w.uniqueBuyerGrowth],
    ['buySellImbalance', norm.buySellImbalance, w.buySellImbalance],
    ['liquidityGrowth', norm.liquidityGrowth, w.liquidityGrowth],
    ['buyerQualityImprovement', norm.buyerQualityImprovement, w.buyerQualityImprovement],
    ['volumeAcceleration', norm.volumeAcceleration, w.volumeAcceleration],
    ['priceConfirmation', norm.priceConfirmation, w.priceConfirmation],
  ];

  const rawByKey: Record<string, number> = {
    smartMoneyNetFlow: c.smartMoneyNetFlowUsd,
    whaleNetFlow: c.whaleNetFlowUsd,
    uniqueBuyerGrowth: c.uniqueBuyerGrowth,
    buySellImbalance: c.buySellImbalance,
    liquidityGrowth: c.liquidityGrowthPct,
    buyerQualityImprovement: c.buyerQualityImprovement,
    volumeAcceleration: c.volumeAcceleration,
    priceConfirmation: c.priceConfirmation,
  };

  const components: ComponentBreakdown[] = rows.map(([key, normalized, weight]) => ({
    key,
    raw: rawByKey[key] ?? 0,
    normalized: round(normalized, 4),
    weight,
    contribution: round(normalized * weight * 100, 4),
  }));

  const baseScore = round(
    components.reduce((s, cb) => s + cb.contribution, 0),
    4,
  );

  const penalties = computePenalties(input);
  const totalPenalty = round(
    penalties.reduce((s, p) => s + p.applied, 0),
    4,
  );

  const scorePreClamp = round(baseScore - totalPenalty, 4);
  const score = round(clamp(scorePreClamp, 0, 100), 2);

  // Risk score: total triggered risk points, capped at 100 (independent scale).
  const riskScore = round(clamp(totalPenalty, 0, 100), 2);

  return {
    score,
    scorePreClamp,
    baseScore,
    signal: signalLabel(score),
    components,
    penalties,
    totalPenalty,
    riskScore,
  };
}

/**
 * Evaluate every SPEC §12 risk penalty. Each returns a breakdown with the
 * applied points, the configured max, a 0..1 severity, and human evidence.
 * Boolean risks apply full weight; magnitude risks scale by severity past their
 * trigger threshold.
 */
function computePenalties(input: OpportunityInput): PenaltyBreakdown[] {
  const r = input.risk;
  const P = RISK_PENALTIES;
  const T = RISK_TRIGGERS;
  const out: PenaltyBreakdown[] = [];

  const add = (key: string, max: number, severity: number, evidence: string): void => {
    const sev = clamp01(severity);
    if (sev <= 0) return;
    out.push({
      key,
      applied: round(max * sev, 4),
      maxPenalty: max,
      severity: round(sev, 4),
      evidence,
    });
  };

  // Deployer-linked selling — severity scales with sell magnitude.
  if (r.deployerLinkedNetFlowUsd < 0) {
    const sev = clamp01(Math.abs(r.deployerLinkedNetFlowUsd) / T.veryLowLiquidityUsd);
    add(
      'deployerLinkedSelling',
      P.deployerLinkedSelling,
      sev,
      `Deployer-linked net selling of $${Math.round(Math.abs(r.deployerLinkedNetFlowUsd)).toLocaleString('en-US')}`,
    );
  }

  // Liquidity removal — triggered past the removal fraction, scaled to full drop.
  if (r.liquidityChangePct <= -T.liquidityRemovalFraction) {
    const drop = Math.abs(r.liquidityChangePct);
    const sev = clamp01((drop - T.liquidityRemovalFraction) / (1 - T.liquidityRemovalFraction));
    // Ensure a just-triggered removal still carries a floor of severity.
    add(
      'liquidityRemoval',
      P.liquidityRemoval,
      Math.max(0.25, sev),
      `Liquidity fell ${(drop * 100).toFixed(0)}%`,
    );
  }

  // Extreme holder concentration — max of buyer/seller top-N share.
  const conc = Math.max(r.buyerConcentration, r.sellerConcentration);
  if (conc >= T.extremeConcentrationFraction) {
    const sev = clamp01(
      (conc - T.extremeConcentrationFraction) / (1 - T.extremeConcentrationFraction),
    );
    add(
      'extremeHolderConcentration',
      P.extremeHolderConcentration,
      Math.max(0.4, sev),
      `Top buyers/sellers hold ${(conc * 100).toFixed(0)}% of volume`,
    );
  }

  // Wash-trading likelihood.
  if (r.washTradingScore !== undefined && r.washTradingScore > 0) {
    add(
      'washTradingLikelihood',
      P.washTradingLikelihood,
      r.washTradingScore,
      `Wash-trading likelihood ${(r.washTradingScore * 100).toFixed(0)}%`,
    );
  }

  // Related-wallet concentration.
  if (
    r.relatedWalletConcentration !== undefined &&
    r.relatedWalletConcentration >= T.relatedWalletConcentrationFraction
  ) {
    const sev = clamp01(
      (r.relatedWalletConcentration - T.relatedWalletConcentrationFraction) /
        (1 - T.relatedWalletConcentrationFraction),
    );
    add(
      'relatedWalletConcentration',
      P.relatedWalletConcentration,
      Math.max(0.4, sev),
      `Related wallets account for ${(r.relatedWalletConcentration * 100).toFixed(0)}% of volume`,
    );
  }

  // Very low liquidity.
  if (r.liquidityUsd != null && r.liquidityUsd < T.veryLowLiquidityUsd) {
    const sev = clamp01(1 - r.liquidityUsd / T.veryLowLiquidityUsd);
    add(
      'veryLowLiquidity',
      P.veryLowLiquidity,
      Math.max(0.3, sev),
      `Pool liquidity is only $${Math.round(r.liquidityUsd).toLocaleString('en-US')}`,
    );
  }

  // Unverified contract.
  if (r.contractVerified === false) {
    add('unverifiedContract', P.unverifiedContract, 1, 'Token contract is unverified');
  }

  // Abnormal transfer restrictions.
  if (r.abnormalTransferRestrictions === true) {
    add(
      'abnormalTransferRestrictions',
      P.abnormalTransferRestrictions,
      1,
      'Abnormal transfer restrictions detected',
    );
  }

  // Unreliable price.
  if (r.priceConfidence < MIN_DISPLAYABLE_PRICE_CONFIDENCE) {
    const sev = clamp01(1 - r.priceConfidence / MIN_DISPLAYABLE_PRICE_CONFIDENCE);
    add(
      'unreliablePrice',
      P.unreliablePrice,
      Math.max(0.5, sev),
      `Price confidence ${Math.round(r.priceConfidence)} is below the display threshold`,
    );
  }

  // Insufficient historical data.
  if (r.dataConfidenceScore < T.insufficientHistoryConfidence) {
    const sev = clamp01(1 - r.dataConfidenceScore / T.insufficientHistoryConfidence);
    add(
      'insufficientHistory',
      P.insufficientHistory,
      Math.max(0.4, sev),
      `Data confidence ${Math.round(r.dataConfidenceScore)} is low`,
    );
  }

  return out;
}
