/**
 * DecodedSwap → NormalizedTrade (SPEC §5). Identifies base/quote from the pool
 * config, derives side (BUY = trader receives the base token), decimal-normalizes
 * amounts to raw strings, and applies the tiered price engine. Produces null for
 * degenerate/excluded swaps (zero base amount, WETH wrap/unwrap).
 *
 * Trader attribution: we use the event recipient (`to`/`recipient`) as the
 * trader because router-mediated swaps have the router as `sender`. The recipient
 * is the party that actually receives the output. Caveat: for some router
 * topologies the recipient can itself be an intermediary; when the event lacks a
 * usable recipient we fall back to the transaction sender (`txFrom`). This is a
 * best-effort attribution and is documented in the handoff.
 */

import { ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import type { Hex, NormalizedTrade, TradeSide, WalletClass } from '@chainscope/shared';
import type { DecodedSwap, PoolConfig } from './adapters/types.js';
import { priceSwap, type PricingConfig } from './pricing.js';

export interface TokenInfo {
  readonly address: Hex;
  readonly symbol: string;
  readonly decimals: number;
}

export interface WalletClassResolution {
  readonly walletClass: WalletClass;
  readonly confidence: number;
}

export interface NormalizeContext {
  readonly pool: PoolConfig;
  readonly base: TokenInfo;
  readonly quote: TokenInfo;
  readonly pricing: PricingConfig;
  readonly blockTimestamp: Date;
  /** Fallback trader when the event carries no usable recipient. */
  readonly txFrom?: Hex;
  /** Optional pre-resolved wallet class (demo/live classifier). Defaults UNKNOWN. */
  readonly walletClass?: WalletClassResolution;
  readonly isDemo?: boolean;
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** Deterministic trade id keyed on the unique (chain, tx, logIndex) triple. */
export function tradeId(chainId: number, txHash: Hex, logIndex: number): string {
  return `${chainId}-${txHash.toLowerCase()}-${logIndex}`;
}

export function normalizeSwap(decoded: DecodedSwap, ctx: NormalizeContext): NormalizedTrade | null {
  const { pool, base, quote } = ctx;

  // WETH wrap/unwrap exclusion: a swap where base and quote are the same token,
  // or where the "base" IS the wrapped-native and there is no distinct quote,
  // is not a directional trade. (Deposit/Withdrawal events never reach here
  // because we only decode registered pool Swap logs — documented in handoff.)
  if (base.address.toLowerCase() === quote.address.toLowerCase()) return null;

  const baseDelta = pool.baseIsToken0 ? decoded.amount0Delta : decoded.amount1Delta;
  const quoteDelta = pool.baseIsToken0 ? decoded.amount1Delta : decoded.amount0Delta;

  // Zero base movement → not a trade.
  if (baseDelta === 0n) return null;

  const side: TradeSide = baseDelta > 0n ? 'BUY' : 'SELL';
  const tokenAmount = abs(baseDelta).toString();
  const quoteAmount = abs(quoteDelta).toString();

  const price = priceSwap({
    baseAmountRaw: tokenAmount,
    baseDecimals: base.decimals,
    quoteAmountRaw: quoteAmount,
    quoteDecimals: quote.decimals,
    quoteAddress: quote.address,
    pricing: ctx.pricing,
  });

  const recipientUsable = decoded.recipient && decoded.recipient !== ZERO_ADDR;
  const trader = (recipientUsable ? decoded.recipient : ctx.txFrom ?? decoded.sender) as Hex;

  const wallet = ctx.walletClass ?? { walletClass: 'UNKNOWN' as WalletClass, confidence: 0 };

  return {
    id: tradeId(ROBINHOOD_CHAIN_ID, decoded.transactionHash, decoded.logIndex),
    chainId: ROBINHOOD_CHAIN_ID,
    transactionHash: decoded.transactionHash,
    logIndex: decoded.logIndex,
    blockNumber: decoded.blockNumber,
    blockTimestamp: ctx.blockTimestamp,
    dexName: decoded.dexName,
    ...(decoded.routerAddress ? { routerAddress: decoded.routerAddress } : {}),
    poolAddress: decoded.poolAddress,
    traderAddress: trader,
    tokenAddress: base.address,
    tokenSymbol: base.symbol,
    quoteTokenAddress: quote.address,
    quoteTokenSymbol: quote.symbol,
    side,
    tokenAmount,
    quoteAmount,
    priceUsd: price.priceUsd,
    valueUsd: price.valueUsd,
    priceConfidence: price.priceConfidence,
    walletClass: wallet.walletClass,
    walletClassificationConfidence: wallet.confidence,
    isDemo: ctx.isDemo ?? false,
  };
}
