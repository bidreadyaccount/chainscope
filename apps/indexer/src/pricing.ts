/**
 * Price engine — MVP price-priority tiers 1, 2 and 5 (SPEC §11).
 *
 *   Tier 1  direct stablecoin pool            → quoteUsd = quote amount, conf 95
 *   Tier 2  native (wrapped-ETH) pair via a   → quoteUsd = quote * ethUsdRef, conf 80
 *           trusted USD reference price
 *   Tier 5  unknown / inadequate confidence   → priceUsd = null, conf 0
 *
 * Tiers 3 (route through deepest pool) and 4 (time-weighted estimate) are
 * documented future work — they need a live pool graph we cannot build without
 * verified addresses. When neither tier 1 nor tier 2 applies we return null with
 * confidence 0 rather than fabricating a price (BUILD_BRIEF guardrail).
 */

import { PRICE_SOURCE_CONFIDENCE } from '@chainscope/config';
import { fromRawAmount, type Hex } from '@chainscope/shared';

export type PriceSourceTag = 'stable_pool' | 'native_reference' | 'unknown';

export interface PricingConfig {
  /** Lowercased stablecoin token addresses used as USD anchors. */
  readonly stablecoins: ReadonlySet<string>;
  /** Wrapped-native (WETH-equivalent) token address, if configured. */
  readonly wrappedNative?: Hex;
  /** Trusted native-token USD reference price (tier 2), or null if unavailable. */
  readonly ethUsdReferenceUsd: number | null;
}

export interface PriceResult {
  readonly priceUsd: number | null;
  readonly valueUsd: number | null;
  readonly priceConfidence: number;
  readonly source: PriceSourceTag;
}

/**
 * Price a swap from the quote side. `baseAmountRaw`/`quoteAmountRaw` are raw
 * integer strings; `quoteAddress` decides the tier.
 */
export function priceSwap(params: {
  baseAmountRaw: string;
  baseDecimals: number;
  quoteAmountRaw: string;
  quoteDecimals: number;
  quoteAddress: Hex;
  pricing: PricingConfig;
}): PriceResult {
  const { baseAmountRaw, baseDecimals, quoteAmountRaw, quoteDecimals, quoteAddress, pricing } =
    params;

  const baseHuman = fromRawAmount(baseAmountRaw, baseDecimals);
  const quoteHuman = fromRawAmount(quoteAmountRaw, quoteDecimals);
  const quoteLower = quoteAddress.toLowerCase();

  let quoteUsd: number | null = null;
  let confidence = PRICE_SOURCE_CONFIDENCE.UNKNOWN;
  let source: PriceSourceTag = 'unknown';

  if (pricing.stablecoins.has(quoteLower)) {
    quoteUsd = quoteHuman;
    confidence = PRICE_SOURCE_CONFIDENCE.STABLE_POOL;
    source = 'stable_pool';
  } else if (
    pricing.wrappedNative &&
    quoteLower === pricing.wrappedNative.toLowerCase() &&
    pricing.ethUsdReferenceUsd !== null &&
    pricing.ethUsdReferenceUsd > 0
  ) {
    quoteUsd = quoteHuman * pricing.ethUsdReferenceUsd;
    confidence = PRICE_SOURCE_CONFIDENCE.NATIVE_PAIR;
    source = 'native_reference';
  }

  if (quoteUsd === null || baseHuman <= 0) {
    return {
      priceUsd: null,
      valueUsd: null,
      priceConfidence: PRICE_SOURCE_CONFIDENCE.UNKNOWN,
      source: 'unknown',
    };
  }

  const priceUsd = quoteUsd / baseHuman;
  return {
    priceUsd: round(priceUsd, 10),
    valueUsd: round(quoteUsd, 2),
    priceConfidence: confidence,
    source,
  };
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
