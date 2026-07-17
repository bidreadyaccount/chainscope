import {
  WALLET_QUALITY_WEIGHTS,
  DATA_CONFIDENCE_WEIGHTS,
  CONCENTRATION_TOP_N,
  METRICS_CONFIG,
  type WalletClassName,
} from '@chainscope/config';
import type { WalletClass } from '../../types/wallet.js';
import { mean, median, topNShare, clamp01, round } from '../math.js';
import type { MetricTrade, TokenMetricsInput, TokenMetrics } from './types.js';

const WHALE_CLASSES = new Set<WalletClass>(['MEGA_WHALE', 'WHALE']);

function usd(t: MetricTrade): number {
  return t.valueUsd ?? 0;
}

/** Signed contribution to directional net flow: +buy / -sell. */
function signed(t: MetricTrade): number {
  return (t.side === 'BUY' ? 1 : -1) * usd(t);
}

/**
 * Compute every SPEC §10 metric for a single token over one window.
 *
 * Directional net-flow conviction (`netFlowUsd`) excludes market-maker and
 * protocol flow by default — their volume is inventory management, not
 * conviction. Options can re-include them. Raw buy/sell volume totals always
 * include all classes; MM and protocol volume are also reported separately.
 */
export function computeTokenMetrics(input: TokenMetricsInput): TokenMetrics {
  const { trades } = input;
  const opts = input.options ?? {};
  const includeMM = opts.includeMarketMakerFlow === true;
  const includeProto = opts.includeProtocolFlow === true;

  let buyVolumeUsd = 0;
  let sellVolumeUsd = 0;
  let buys = 0;
  let sells = 0;

  let whaleBuy = 0;
  let whaleSell = 0;
  let smBuy = 0;
  let smSell = 0;
  let retailNet = 0;
  let newWalletNet = 0;
  let botVol = 0;
  let deployerNet = 0;
  let mmVol = 0;
  let protoVol = 0;

  let convictionNet = 0; // netFlowUsd with MM/protocol handled per options

  const buyers = new Set<string>();
  const sellers = new Set<string>();
  const buyVolByWallet = new Map<string, number>();
  const sellVolByWallet = new Map<string, number>();

  const pricedSizes: number[] = [];
  const volumeByClass = new Map<WalletClass, number>();

  let priceConfSum = 0;
  let pricedTradeCount = 0;

  for (const t of trades) {
    const v = usd(t);
    const cls = t.walletClass;

    if (t.side === 'BUY') {
      buys += 1;
      buyVolumeUsd += v;
      buyers.add(t.traderAddress);
      buyVolByWallet.set(t.traderAddress, (buyVolByWallet.get(t.traderAddress) ?? 0) + v);
    } else {
      sells += 1;
      sellVolumeUsd += v;
      sellers.add(t.traderAddress);
      sellVolByWallet.set(t.traderAddress, (sellVolByWallet.get(t.traderAddress) ?? 0) + v);
    }

    volumeByClass.set(cls, (volumeByClass.get(cls) ?? 0) + v);

    if (t.valueUsd !== null) {
      pricedSizes.push(t.valueUsd);
      priceConfSum += t.priceConfidence;
      pricedTradeCount += 1;
    }

    // Class-partitioned flows
    const s = signed(t);
    if (WHALE_CLASSES.has(cls)) {
      if (t.side === 'BUY') whaleBuy += v;
      else whaleSell += v;
    }
    switch (cls) {
      case 'SMART_MONEY':
        if (t.side === 'BUY') smBuy += v;
        else smSell += v;
        break;
      case 'RETAIL':
        retailNet += s;
        break;
      case 'NEW_WALLET':
        newWalletNet += s;
        break;
      case 'BOT':
        botVol += v;
        break;
      case 'DEPLOYER_LINKED':
        deployerNet += s;
        break;
      case 'MARKET_MAKER':
        mmVol += v;
        break;
      case 'PROTOCOL':
        protoVol += v;
        break;
      default:
        break;
    }

    // Directional conviction net flow with MM/protocol exclusion by default.
    const isMM = cls === 'MARKET_MAKER';
    const isProto = cls === 'PROTOCOL';
    if ((!isMM || includeMM) && (!isProto || includeProto)) {
      convictionNet += s;
    }
  }

  const totalVolume = buyVolumeUsd + sellVolumeUsd;

  // Wallet-quality score: volume-weighted per-class quality (0..100).
  let qualityWeightedSum = 0;
  for (const [cls, vol] of volumeByClass) {
    const qw = WALLET_QUALITY_WEIGHTS[cls as WalletClassName] ?? 0.3;
    qualityWeightedSum += qw * vol;
  }
  const walletQualityScore =
    totalVolume > 0 ? round((qualityWeightedSum / totalVolume) * 100, 2) : 0;

  // Data confidence: price-coverage (avg confidence over priced trades) blended
  // with sample-size adequacy vs the configured minimum.
  const avgPriceConf = pricedTradeCount > 0 ? priceConfSum / pricedTradeCount : 0;
  const sampleAdequacy = clamp01(
    trades.length / Math.max(1, METRICS_CONFIG.minTradesForConfidence),
  );
  const dcw = DATA_CONFIDENCE_WEIGHTS;
  const dataConfidenceScore = round(
    dcw.priceCoverage * avgPriceConf + dcw.sampleSize * sampleAdequacy * 100,
    2,
  );

  const buyerConcentration = round(
    topNShare([...buyVolByWallet.values()], CONCENTRATION_TOP_N, buyVolumeUsd),
    4,
  );
  const sellerConcentration = round(
    topNShare([...sellVolByWallet.values()], CONCENTRATION_TOP_N, sellVolumeUsd),
    4,
  );

  const priceChangePct = pctChange(input.currentPriceUsd, input.prior?.priceUsd);
  const liquidityChangePct = pctChange(input.currentLiquidityUsd, input.prior?.liquidityUsd);

  const windowVolume = totalVolume;
  const volumeAcceleration =
    input.baselineVolumeUsd !== undefined && input.baselineVolumeUsd > 0
      ? round((windowVolume - input.baselineVolumeUsd) / input.baselineVolumeUsd, 4)
      : null;

  const holderGrowth =
    input.holdersNow != null && input.holdersPrior != null && input.holdersPrior > 0
      ? round((input.holdersNow - input.holdersPrior) / input.holdersPrior, 4)
      : null;

  const uniqueBuyerGrowth =
    input.prior?.uniqueBuyers != null && input.prior.uniqueBuyers > 0
      ? round((buyers.size - input.prior.uniqueBuyers) / input.prior.uniqueBuyers, 4)
      : null;

  const buyerQualityImprovement =
    input.prior?.walletQualityScore != null
      ? round(walletQualityScore - input.prior.walletQualityScore, 2)
      : null;

  return {
    window: input.window,
    windowStartMs: input.windowStartMs,
    windowEndMs: input.windowEndMs,

    buyVolumeUsd: round(buyVolumeUsd, 2),
    sellVolumeUsd: round(sellVolumeUsd, 2),
    netFlowUsd: round(convictionNet, 2),

    buys,
    sells,
    uniqueBuyers: buyers.size,
    uniqueSellers: sellers.size,
    buySellRatio: sells > 0 ? round(buys / sells, 4) : buys > 0 ? null : 0,

    whaleBuyVolumeUsd: round(whaleBuy, 2),
    whaleSellVolumeUsd: round(whaleSell, 2),
    whaleNetFlowUsd: round(whaleBuy - whaleSell, 2),

    smartMoneyBuyVolumeUsd: round(smBuy, 2),
    smartMoneySellVolumeUsd: round(smSell, 2),
    smartMoneyNetFlowUsd: round(smBuy - smSell, 2),

    retailNetFlowUsd: round(retailNet, 2),
    newWalletNetFlowUsd: round(newWalletNet, 2),
    botAssociatedVolumeUsd: round(botVol, 2),
    deployerLinkedNetFlowUsd: round(deployerNet, 2),
    marketMakerVolumeUsd: round(mmVol, 2),
    protocolVolumeUsd: round(protoVol, 2),

    avgTradeSizeUsd: round(mean(pricedSizes), 2),
    medianTradeSizeUsd: round(median(pricedSizes), 2),

    priceChangePct,
    volumeAcceleration,
    liquidityChangePct,
    holderGrowth,

    buyerConcentration,
    sellerConcentration,

    walletQualityScore,
    dataConfidenceScore,

    uniqueBuyerGrowth,
    buyerQualityImprovement,

    tradeCount: trades.length,
    pricedTradeCount,
  };
}

function pctChange(current?: number | null, prior?: number | null): number | null {
  if (current == null || prior == null || prior === 0) return null;
  return round((current - prior) / prior, 4);
}
