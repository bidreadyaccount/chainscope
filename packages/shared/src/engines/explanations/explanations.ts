import {
  EXPLANATION_THRESHOLDS,
  RISK_TRIGGERS,
  CONCENTRATION_TOP_N,
  MIN_DISPLAYABLE_PRICE_CONFIDENCE,
  TIME_WINDOW_LABEL,
} from '@chainscope/config';
import { formatUsd, formatPct, formatCount } from './format.js';
import type { ExplanationInput, Explanations } from './types.js';

/**
 * Deterministic, evidence-based decision explanations (SPEC §16). Every factor
 * is gated by a threshold on a real metric value and rendered with the actual
 * number formatted ($82,400 / 63%). No LLM anywhere; identical input always
 * yields identical output. Risk wording stays hedged.
 */
export function generateExplanations(input: ExplanationInput): Explanations {
  const m = input.metrics;
  const t = EXPLANATION_THRESHOLDS;
  const positiveFactors: string[] = [];
  const riskFactors: string[] = [];

  const windowText = input.window ? ` over the ${TIME_WINDOW_LABEL[input.window]} window` : '';

  // --- Positive factors ---------------------------------------------------
  if (m.smartMoneyNetFlowUsd >= t.significantNetFlowUsd) {
    const who =
      input.counts?.smartMoneyBuyers && input.counts.smartMoneyBuyers > 0
        ? `${formatCount(input.counts.smartMoneyBuyers)} smart-money wallet(s)`
        : 'Smart-money wallets';
    positiveFactors.push(
      `${who} bought a net ${formatUsd(m.smartMoneyNetFlowUsd)}${windowText}.`,
    );
  }

  if (m.whaleNetFlowUsd >= t.significantNetFlowUsd) {
    const who =
      input.counts?.whaleBuyers && input.counts.whaleBuyers > 0
        ? `${formatCount(input.counts.whaleBuyers)} whale(s)`
        : 'Whales';
    positiveFactors.push(`${who} accumulated a net ${formatUsd(m.whaleNetFlowUsd)}${windowText}.`);
  }

  if (m.uniqueBuyerGrowth !== null && m.uniqueBuyerGrowth >= t.strongBuyerGrowth) {
    positiveFactors.push(
      `Unique buyers grew ${formatPct(m.uniqueBuyerGrowth)} to ${formatCount(m.uniqueBuyers)}.`,
    );
  }

  const totalDirectional = m.buyVolumeUsd + m.sellVolumeUsd;
  const imbalance = totalDirectional > 0 ? (m.buyVolumeUsd - m.sellVolumeUsd) / totalDirectional : 0;
  if (imbalance >= t.strongImbalance) {
    positiveFactors.push(
      `Buying outweighed selling: ${formatUsd(m.buyVolumeUsd)} bought vs ${formatUsd(m.sellVolumeUsd)} sold.`,
    );
  }

  if (m.liquidityChangePct !== null && m.liquidityChangePct >= t.significantLiquidityGrowth) {
    positiveFactors.push(`Liquidity grew ${formatPct(m.liquidityChangePct)}${windowText}.`);
  }

  if (
    m.buyerQualityImprovement !== null &&
    m.buyerQualityImprovement >= t.buyerQualityImprovement
  ) {
    positiveFactors.push(
      `Buyer quality improved by ${m.buyerQualityImprovement.toFixed(0)} points.`,
    );
  } else if (m.walletQualityScore >= t.strongWalletQuality) {
    positiveFactors.push(
      `High-quality participant mix (wallet-quality score ${m.walletQualityScore.toFixed(0)}).`,
    );
  }

  if (
    m.volumeAcceleration !== null &&
    m.volumeAcceleration >= t.significantVolumeAcceleration
  ) {
    positiveFactors.push(`Volume accelerated ${formatPct(m.volumeAcceleration)} versus baseline.`);
  }

  // --- Risk factors (hedged) ---------------------------------------------
  const conc = Math.max(m.buyerConcentration, m.sellerConcentration);
  if (conc >= RISK_TRIGGERS.extremeConcentrationFraction) {
    const side = m.buyerConcentration >= m.sellerConcentration ? 'buyers' : 'sellers';
    riskFactors.push(
      `The top ${CONCENTRATION_TOP_N} ${side} account for ${formatPct(conc)} of recent volume.`,
    );
  }

  if (m.deployerLinkedNetFlowUsd < 0) {
    const who =
      input.counts?.deployerSellers && input.counts.deployerSellers > 0
        ? `${formatCount(input.counts.deployerSellers)} deployer-linked wallet(s)`
        : 'Deployer-linked wallets';
    riskFactors.push(
      `${who} sold a net ${formatUsd(Math.abs(m.deployerLinkedNetFlowUsd))}${windowText}.`,
    );
  }

  if (m.liquidityChangePct !== null && m.liquidityChangePct <= -RISK_TRIGGERS.liquidityRemovalFraction) {
    riskFactors.push(`Liquidity fell ${formatPct(Math.abs(m.liquidityChangePct))}${windowText}.`);
  }

  if (input.liquidityUsd != null && input.liquidityUsd < RISK_TRIGGERS.veryLowLiquidityUsd) {
    riskFactors.push(`Pool liquidity is only ${formatUsd(input.liquidityUsd)} — thin market.`);
  }

  if (input.priceConfidence !== undefined && input.priceConfidence < MIN_DISPLAYABLE_PRICE_CONFIDENCE) {
    riskFactors.push('Price confidence is below the reliable-display threshold.');
  }

  if (m.dataConfidenceScore < RISK_TRIGGERS.insufficientHistoryConfidence) {
    riskFactors.push(
      `Limited data: confidence score is ${m.dataConfidenceScore.toFixed(0)} of 100.`,
    );
  }

  if (m.botAssociatedVolumeUsd > 0 && totalDirectional > 0) {
    const botShare = m.botAssociatedVolumeUsd / totalDirectional;
    if (botShare >= t.strongImbalance) {
      riskFactors.push(
        `Possible automated activity: ${formatPct(botShare)} of volume is bot-associated.`,
      );
    }
  }

  return { positiveFactors, riskFactors };
}
