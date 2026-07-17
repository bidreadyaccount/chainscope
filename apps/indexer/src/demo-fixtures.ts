/**
 * Deterministic demo fixtures shared by the DemoProvider and the end-to-end
 * indexer test. Everything is derived from the same seed the API/DB use, so the
 * synthetic swap logs decode back to trades whose token addresses already exist
 * in the seeded DB. This lets the ENTIRE live path — block → log → adapter
 * decode → normalize → pipeline — run with zero network.
 *
 * Pool assignment:
 *   - one pool per demo token; base = the token, quote = its quote asset.
 *   - token0/token1 ordered by address (like real Uniswap), so base lands on
 *     token0 for some pools and token1 for others (exercises both orderings).
 *   - kind alternates univ2 / univ3 by token index, so both decoders are used.
 *
 * Pricing:
 *   - the demo USDC quote is treated as a stablecoin (tier 1),
 *   - the demo WETH quote is the wrapped-native with a trusted ETH/USD reference
 *     (tier 2). Both produce real USD prices end-to-end.
 */

import { encodeAbiParameters, keccak256, pad, toBytes } from 'viem';
import {
  generateTokens,
  generateWallets,
  mulberry32,
  DEMO_QUOTE_USDC,
  DEMO_QUOTE_WETH,
  DEMO_ROUTER,
  DEMO_ETH_USD,
  type DemoToken,
  type Hex,
  type NormalizedTrade,
} from '@chainscope/shared';
import type { PoolConfig } from './adapters/types.js';
import type { ProviderLog } from './provider/types.js';
import type { TokenInfo, WalletClassResolution } from './normalize.js';
import type { PricingConfig } from './pricing.js';
import { UNIV2_SWAP_TOPIC0 } from './adapters/univ2.js';
import { UNIV3_SWAP_TOPIC0 } from './adapters/univ3.js';

export const DEMO_STREAM = 'demo';

function lower(a: string): string {
  return a.toLowerCase();
}

/** Deterministic block hash for a demo block number. */
export function demoBlockHash(seed: number, blockNumber: bigint): Hex {
  return keccak256(toBytes(`demoblock:${seed}:${blockNumber.toString()}`));
}

/** Pool config for a demo token (base = the token, quote = its quote asset). */
export function demoPoolConfig(token: DemoToken, index: number): PoolConfig {
  const baseIsToken0 = lower(token.address) < lower(token.quoteAddress);
  return {
    poolAddress: token.poolAddress,
    kind: index % 2 === 0 ? 'univ2' : 'univ3',
    dexName: token.dexName,
    routerAddress: token.routerAddress,
    token0Address: baseIsToken0 ? token.address : token.quoteAddress,
    token1Address: baseIsToken0 ? token.quoteAddress : token.address,
    baseIsToken0,
  };
}

export function demoPoolConfigs(seed: number): PoolConfig[] {
  return generateTokens(mulberry32(seed)).map((t, i) => demoPoolConfig(t, i));
}

/** Base + quote token metadata for the demo market. */
export function demoTokenInfos(seed: number): TokenInfo[] {
  const tokens = generateTokens(mulberry32(seed));
  const infos: TokenInfo[] = [
    {
      address: DEMO_QUOTE_USDC.address,
      symbol: DEMO_QUOTE_USDC.symbol,
      decimals: DEMO_QUOTE_USDC.decimals,
    },
    {
      address: DEMO_QUOTE_WETH.address,
      symbol: DEMO_QUOTE_WETH.symbol,
      decimals: DEMO_QUOTE_WETH.decimals,
    },
  ];
  for (const t of tokens)
    infos.push({ address: t.address, symbol: t.symbol, decimals: t.decimals });
  return infos;
}

/** Demo pricing config: USDC = stablecoin (tier 1), WETH = native ref (tier 2). */
export function demoPricingConfig(): PricingConfig {
  return {
    stablecoins: new Set([lower(DEMO_QUOTE_USDC.address)]),
    wrappedNative: DEMO_QUOTE_WETH.address,
    ethUsdReferenceUsd: DEMO_ETH_USD,
  };
}

/** trader address (lowercased) → wallet class, so demo rankings look faithful. */
export function demoWalletClassMap(seed: number): Map<string, WalletClassResolution> {
  const { wallets } = generateWallets(mulberry32(seed));
  const map = new Map<string, WalletClassResolution>();
  for (const w of wallets) {
    map.set(lower(w.address), {
      walletClass: w.primaryClass,
      confidence: w.classificationConfidence,
    });
  }
  return map;
}

const V2_DATA_PARAMS = [
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
] as const;

const V3_DATA_PARAMS = [
  { type: 'int256' },
  { type: 'int256' },
  { type: 'uint160' },
  { type: 'uint128' },
  { type: 'int24' },
] as const;

function absBig(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/**
 * Encode a synthetic swap `ProviderLog` for a demo trade, consistent with the
 * pool's kind and token ordering, so the matching adapter decodes it back to the
 * same side/amounts. Router is `sender`, trader is `to`/`recipient`.
 */
export function encodeSwapLog(
  trade: NormalizedTrade,
  pool: PoolConfig,
  blockHash: Hex,
): ProviderLog {
  const baseAmt = BigInt(trade.tokenAmount);
  const quoteAmt = BigInt(trade.quoteAmount);
  // Trader-perspective deltas: BUY receives base / pays quote.
  const baseDelta = trade.side === 'BUY' ? baseAmt : -baseAmt;
  const quoteDelta = trade.side === 'BUY' ? -quoteAmt : quoteAmt;

  const amount0Delta = pool.baseIsToken0 ? baseDelta : quoteDelta;
  const amount1Delta = pool.baseIsToken0 ? quoteDelta : baseDelta;

  const sender = (trade.routerAddress ?? DEMO_ROUTER) as Hex;
  const to = trade.traderAddress;
  const topic0 = pool.kind === 'univ2' ? UNIV2_SWAP_TOPIC0 : UNIV3_SWAP_TOPIC0;

  let data: Hex;
  if (pool.kind === 'univ2') {
    const amount0In = amount0Delta < 0n ? absBig(amount0Delta) : 0n;
    const amount1In = amount1Delta < 0n ? absBig(amount1Delta) : 0n;
    const amount0Out = amount0Delta > 0n ? amount0Delta : 0n;
    const amount1Out = amount1Delta > 0n ? amount1Delta : 0n;
    data = encodeAbiParameters(V2_DATA_PARAMS, [amount0In, amount1In, amount0Out, amount1Out]);
  } else {
    // Pool perspective is the negation of the trader delta.
    data = encodeAbiParameters(V3_DATA_PARAMS, [-amount0Delta, -amount1Delta, 0n, 0n, 0]);
  }

  return {
    address: pool.poolAddress,
    topics: [topic0, pad(sender, { size: 32 }), pad(to, { size: 32 })],
    data,
    blockNumber: trade.blockNumber,
    blockHash,
    transactionHash: trade.transactionHash,
    logIndex: trade.logIndex,
  };
}
