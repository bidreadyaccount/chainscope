import {
  WALLET_THRESHOLDS,
  WALLET_CLASS_PRECEDENCE,
  BOT_INDICATORS,
  DEPLOYER_LINK,
  DEPLOYER_EVIDENCE_WEIGHTS,
} from '@chainscope/config';
import type { WalletClass } from '../../types/wallet.js';
import type { WalletClassification, WalletLabelInfo } from '../../types/wallet.js';
import { clamp, median } from '../math.js';
import type { WalletActivitySummary } from './types.js';
import { scoreBotProbability } from './bot.js';
import { scoreSmartMoney } from './smart-money.js';

/**
 * Precedence (SPEC §7 requires an explicit primary). Sourced from
 * `WALLET_CLASS_PRECEDENCE`; earlier entries win. Rationale, most→least
 * authoritative:
 *   PROTOCOL / MARKET_MAKER   — known-entity flags dominate: their flow must be
 *                               excluded from conviction metrics, so identifying
 *                               them takes priority over size.
 *   DEPLOYER_LINKED           — relationship risk outranks size/behaviour.
 *   BOT                       — automation outranks size (a whale-sized bot is a
 *                               bot for conviction purposes).
 *   MEGA_WHALE > WHALE        — size tiers.
 *   SMART_MONEY               — proven skill ranks above generic large trading.
 *   LARGE_TRADER              — size/typical-trade tier.
 *   NEW_WALLET                — provenance caveat when nothing stronger applies.
 *   RETAIL                    — default for small, established wallets.
 *   UNKNOWN                   — no label matched.
 */
const PRECEDENCE_INDEX = new Map<string, number>(
  WALLET_CLASS_PRECEDENCE.map((c, i) => [c, i]),
);

function precedenceRank(cls: WalletClass): number {
  return PRECEDENCE_INDEX.get(cls) ?? Number.MAX_SAFE_INTEGER;
}

function typicalTrade(sizes: readonly number[]): number {
  return sizes.length > 0 ? median(sizes) : 0;
}

function largestTrade(w: WalletActivitySummary): number {
  if (w.largestTradeUsd !== undefined) return w.largestTradeUsd;
  return w.tradeSizesUsd.length > 0 ? Math.max(...w.tradeSizesUsd) : 0;
}

/**
 * Deployer-linked confidence from weighted evidence (SPEC §8). Each evidence
 * item contributes its configured weight; confidence is the clamped sum.
 */
function deployerConfidence(w: WalletActivitySummary): { confidence: number; reasons: string[] } {
  const ew = DEPLOYER_EVIDENCE_WEIGHTS;
  const reasons: string[] = [];
  let conf = 0;
  if (w.isFundedByDeployer) {
    conf += ew.fundedByDeployer;
    reasons.push('Direct funding from the token deployer');
  }
  if (w.hasEarlyTokenAllocation) {
    conf += ew.earlyAllocation;
    reasons.push('Received an early token allocation');
  }
  if (w.interactedBeforePublicTrading) {
    conf += ew.preLaunchInteraction;
    reasons.push('Interacted with the token before public trading');
  }
  if (
    w.fundingSourceSharedCount !== undefined &&
    w.fundingSourceSharedCount >= BOT_INDICATORS.clusterFundingWalletCount
  ) {
    conf += ew.sharedFundingSource;
    reasons.push('Shares a funding source with related wallets');
  }
  if (w.hasLiquidityManagementRelationship) {
    conf += ew.liquidityManagement;
    reasons.push('Liquidity-management relationship with the token');
  }
  return { confidence: clamp(conf, 0, 100), reasons };
}

/**
 * Classify a wallet into ALL applicable hedged labels and select a primary via
 * documented precedence. Pure — pass `now` for a deterministic timestamp.
 *
 * Returns the Phase-1 `WalletClassification` contract. NOTE: the label objects
 * use `lastCalculatedAt` (the established `WalletLabelInfo` field); the Phase-2
 * brief's `calculatedAt` maps to this field.
 */
export function classifyWallet(
  w: WalletActivitySummary,
  now: number | Date = Date.now(),
): WalletClassification {
  const at = new Date(now).toISOString();
  const labels: WalletLabelInfo[] = [];
  const th = WALLET_THRESHOLDS;

  const typical = typicalTrade(w.tradeSizesUsd);
  const single = largestTrade(w);
  const supply = w.maxSupplyControlFraction ?? 0;

  const label = (
    cls: WalletClass,
    confidence: number,
    reasons: readonly string[],
    supportingMetrics?: Record<string, number | string>,
  ): void => {
    labels.push({
      class: cls,
      confidence: clamp(Math.round(confidence), 0, 100),
      reasons,
      supportingMetrics,
      lastCalculatedAt: at,
    });
  };

  // --- Known-entity flags (highest precedence) ---------------------------
  if (w.isKnownProtocol) {
    label('PROTOCOL', 95, ['Recognized protocol / system address'], { portfolioUsd: w.portfolioValueUsd });
  }
  if (w.isKnownMarketMaker) {
    label('MARKET_MAKER', 90, ['Recognized market-maker address'], {
      portfolioUsd: w.portfolioValueUsd,
    });
  }

  // --- Deployer-linked ----------------------------------------------------
  const dep = deployerConfidence(w);
  if (dep.confidence >= DEPLOYER_LINK.labelConfidence) {
    label('DEPLOYER_LINKED', dep.confidence, dep.reasons, {
      sharedFundingWallets: w.fundingSourceSharedCount ?? 0,
    });
  }

  // --- Bot ----------------------------------------------------------------
  const bot = scoreBotProbability(w);
  if (bot.probability >= BOT_INDICATORS.labelProbability) {
    label('BOT', bot.probability, bot.reasons, { botProbability: bot.probability });
  }

  // --- Size tiers (mega whale / whale) -----------------------------------
  const megaHit =
    w.portfolioValueUsd >= th.megaWhale.portfolioUsd ||
    single >= th.megaWhale.singleTradeUsd ||
    supply >= th.megaWhale.supplyControlFraction;
  const whaleHit =
    w.portfolioValueUsd >= th.whale.portfolioUsd ||
    single >= th.whale.singleTradeUsd ||
    supply >= th.whale.supplyControlFraction;

  if (megaHit) {
    const reasons: string[] = [];
    if (w.portfolioValueUsd >= th.megaWhale.portfolioUsd)
      reasons.push(`Portfolio ≥ $${th.megaWhale.portfolioUsd.toLocaleString('en-US')}`);
    if (single >= th.megaWhale.singleTradeUsd)
      reasons.push(`Single trade ≥ $${th.megaWhale.singleTradeUsd.toLocaleString('en-US')}`);
    if (supply >= th.megaWhale.supplyControlFraction)
      reasons.push(`Controls ≥ ${(th.megaWhale.supplyControlFraction * 100).toFixed(0)}% of supply`);
    label('MEGA_WHALE', 90, reasons, { portfolioUsd: w.portfolioValueUsd, largestTradeUsd: single });
  }
  if (whaleHit) {
    const reasons: string[] = [];
    if (w.portfolioValueUsd >= th.whale.portfolioUsd)
      reasons.push(`Portfolio ≥ $${th.whale.portfolioUsd.toLocaleString('en-US')}`);
    if (single >= th.whale.singleTradeUsd)
      reasons.push(`Single trade ≥ $${th.whale.singleTradeUsd.toLocaleString('en-US')}`);
    if (supply >= th.whale.supplyControlFraction)
      reasons.push(`Controls ≥ ${(th.whale.supplyControlFraction * 100).toFixed(0)}% of supply`);
    label('WHALE', megaHit ? 88 : 82, reasons, {
      portfolioUsd: w.portfolioValueUsd,
      largestTradeUsd: single,
    });
  }

  // --- Smart money --------------------------------------------------------
  if (w.smartMoney) {
    const sm = scoreSmartMoney(w.smartMoney);
    if (sm.status !== 'None') {
      label('SMART_MONEY', sm.score, [`Smart-money status: ${sm.status}`, ...sm.reasons], {
        smartMoneyScore: sm.score,
        status: sm.status,
        closedPositions: sm.closedPositions,
      });
    }
  }

  // --- Large trader -------------------------------------------------------
  if (typical >= th.largeTrader.typicalTradeUsd || w.portfolioValueUsd >= th.largeTrader.portfolioUsd) {
    const reasons: string[] = [];
    if (typical >= th.largeTrader.typicalTradeUsd)
      reasons.push(`Typical trade ≥ $${th.largeTrader.typicalTradeUsd.toLocaleString('en-US')}`);
    if (w.portfolioValueUsd >= th.largeTrader.portfolioUsd)
      reasons.push(`Portfolio ≥ $${th.largeTrader.portfolioUsd.toLocaleString('en-US')}`);
    label('LARGE_TRADER', 70, reasons, { typicalTradeUsd: Math.round(typical) });
  }

  // --- New wallet ---------------------------------------------------------
  if (w.firstSeenDaysAgo <= th.newWallet.firstSeenWithinDays || w.txCount < th.newWallet.maxLifetimeTxs) {
    const reasons: string[] = [];
    if (w.firstSeenDaysAgo <= th.newWallet.firstSeenWithinDays)
      reasons.push(`First seen within ${th.newWallet.firstSeenWithinDays} days`);
    if (w.txCount < th.newWallet.maxLifetimeTxs)
      reasons.push(`Fewer than ${th.newWallet.maxLifetimeTxs} lifetime transactions`);
    label('NEW_WALLET', 75, reasons, { firstSeenDaysAgo: w.firstSeenDaysAgo, txCount: w.txCount });
  }

  // --- Retail -------------------------------------------------------------
  if (
    w.portfolioValueUsd < th.retail.portfolioUsdBelow &&
    (typical === 0 || typical < th.retail.typicalTradeUsdBelow)
  ) {
    label('RETAIL', 60, ['Small portfolio and small typical trade size'], {
      portfolioUsd: w.portfolioValueUsd,
    });
  }

  // --- Primary selection via precedence ----------------------------------
  if (labels.length === 0) {
    label('UNKNOWN', 30, ['Insufficient history to classify']);
  }

  const primaryLabel = [...labels].sort(
    (a, b) => precedenceRank(a.class) - precedenceRank(b.class),
  )[0]!;

  // Deterministic label ordering by precedence for stable output.
  const orderedLabels = [...labels].sort(
    (a, b) => precedenceRank(a.class) - precedenceRank(b.class),
  );

  return {
    primary: primaryLabel.class,
    confidence: primaryLabel.confidence,
    labels: orderedLabels,
  };
}
