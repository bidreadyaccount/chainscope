/**
 * Normalization tests: DecodedSwap → NormalizedTrade — BUY/SELL table-driven
 * correctness for both token orderings, decimal handling (6/8/18) against
 * hand-computed values, price tiers 1/2/5, trader attribution fallback, and
 * duplicate-log removal.
 */
import { describe, expect, it } from 'vitest';
import { PRICE_SOURCE_CONFIDENCE, ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import type { Hex } from '@chainscope/shared';
import type { DecodedSwap, PoolConfig } from './adapters/types.js';
import { normalizeSwap, tradeId, type NormalizeContext, type TokenInfo } from './normalize.js';
import { priceSwap, type PricingConfig } from './pricing.js';
import { dedupeLogs, logKey } from './dedupe.js';
import type { ProviderLog } from './provider/types.js';

const POOL = '0x00000000000000000000000000000000000000a1' as Hex;
const BASE = '0x00000000000000000000000000000000000000b0' as Hex;
const STABLE = '0x00000000000000000000000000000000000000e0' as Hex;
const WNATIVE = '0x00000000000000000000000000000000000000e1' as Hex;
const SENDER = '0x00000000000000000000000000000000000000c1' as Hex;
const TRADER = '0x00000000000000000000000000000000000000d1' as Hex;
const ZERO = '0x0000000000000000000000000000000000000000' as Hex;
const TX = ('0x' + 'ab'.repeat(32)) as Hex;
const BH = ('0x' + 'cd'.repeat(32)) as Hex;

const stablePricing: PricingConfig = {
  stablecoins: new Set([STABLE.toLowerCase()]),
  wrappedNative: WNATIVE,
  ethUsdReferenceUsd: 2000,
};

function mkPool(baseIsToken0: boolean, quote: Hex = STABLE): PoolConfig {
  return {
    poolAddress: POOL,
    kind: 'univ2',
    dexName: 'TestDex',
    token0Address: baseIsToken0 ? BASE : quote,
    token1Address: baseIsToken0 ? quote : BASE,
    baseIsToken0,
  };
}

function mkDecoded(
  pool: PoolConfig,
  amount0Delta: bigint,
  amount1Delta: bigint,
  recipient: Hex = TRADER,
): DecodedSwap {
  return {
    kind: pool.kind,
    dexName: pool.dexName,
    poolAddress: pool.poolAddress,
    token0Address: pool.token0Address,
    token1Address: pool.token1Address,
    amount0Delta,
    amount1Delta,
    sender: SENDER,
    recipient,
    logIndex: 5,
    transactionHash: TX,
    blockNumber: 42n,
    blockHash: BH,
  };
}

function mkCtx(
  pool: PoolConfig,
  baseDecimals: number,
  quoteDecimals: number,
  overrides: Partial<NormalizeContext> = {},
): NormalizeContext {
  const quoteAddr = pool.baseIsToken0 ? pool.token1Address : pool.token0Address;
  const base: TokenInfo = { address: BASE, symbol: 'BASE', decimals: baseDecimals };
  const quote: TokenInfo = { address: quoteAddr, symbol: 'QUOTE', decimals: quoteDecimals };
  return {
    pool,
    base,
    quote,
    pricing: stablePricing,
    blockTimestamp: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('normalizeSwap — direction table', () => {
  // [baseIsToken0, amount0Delta, amount1Delta, expectedSide]
  const cases: Array<[boolean, bigint, bigint, 'BUY' | 'SELL']> = [
    [true, 1000n, -500n, 'BUY'], // trader receives token0(base) → BUY
    [true, -1000n, 500n, 'SELL'], // trader pays token0(base) → SELL
    [false, -500n, 1000n, 'BUY'], // base is token1; trader receives it → BUY
    [false, 500n, -1000n, 'SELL'],
  ];
  it.each(cases)('baseIsToken0=%s a0=%s a1=%s → %s', (baseIs0, a0, a1, side) => {
    const pool = mkPool(baseIs0);
    const trade = normalizeSwap(mkDecoded(pool, a0, a1), mkCtx(pool, 18, 6))!;
    expect(trade.side).toBe(side);
    expect(trade.tokenAmount).toBe('1000');
    expect(trade.quoteAmount).toBe('500');
    expect(trade.tokenAddress).toBe(BASE);
  });
});

describe('normalizeSwap — decimals and pricing (hand-computed)', () => {
  it('18-decimal base vs 6-decimal stable: 2 BASE for 500 USDC → price 250', () => {
    const pool = mkPool(true);
    const decoded = mkDecoded(pool, 2_000000000000000000n, -500_000000n);
    const trade = normalizeSwap(decoded, mkCtx(pool, 18, 6))!;
    expect(trade.priceUsd).toBe(250); // 500 / 2
    expect(trade.valueUsd).toBe(500);
    expect(trade.priceConfidence).toBe(PRICE_SOURCE_CONFIDENCE.STABLE_POOL);
  });

  it('8-decimal base: 0.5 BASE for 20000 USDC → price 40000', () => {
    const pool = mkPool(true);
    const decoded = mkDecoded(pool, 50_000000n, -20000_000000n); // 0.5e8, 20000e6
    const trade = normalizeSwap(decoded, mkCtx(pool, 8, 6))!;
    expect(trade.priceUsd).toBe(40000);
    expect(trade.valueUsd).toBe(20000);
  });

  it('tier 2 — wrapped-native quote priced through the ETH/USD reference', () => {
    const pool = mkPool(true, WNATIVE);
    const decoded = mkDecoded(pool, 4_000000000000000000n, -1_000000000000000000n);
    const trade = normalizeSwap(decoded, mkCtx(pool, 18, 18))!;
    // 1 WETH * $2000 ref = $2000 value; 2000/4 = $500 per BASE.
    expect(trade.priceUsd).toBe(500);
    expect(trade.valueUsd).toBe(2000);
    expect(trade.priceConfidence).toBe(PRICE_SOURCE_CONFIDENCE.NATIVE_PAIR);
  });

  it('tier 5 — unknown quote yields null price, confidence 0 (never fabricated)', () => {
    const unknownQuote = '0x00000000000000000000000000000000000000f9' as Hex;
    const pool = mkPool(true, unknownQuote);
    const decoded = mkDecoded(pool, 1000n, -2000n);
    const trade = normalizeSwap(decoded, mkCtx(pool, 18, 18))!;
    expect(trade.priceUsd).toBeNull();
    expect(trade.valueUsd).toBeNull();
    expect(trade.priceConfidence).toBe(PRICE_SOURCE_CONFIDENCE.UNKNOWN);
  });

  it('tier 2 disabled when no ETH/USD reference is configured', () => {
    const res = priceSwap({
      baseAmountRaw: '1000000000000000000',
      baseDecimals: 18,
      quoteAmountRaw: '1000000000000000000',
      quoteDecimals: 18,
      quoteAddress: WNATIVE,
      pricing: { stablecoins: new Set(), wrappedNative: WNATIVE, ethUsdReferenceUsd: null },
    });
    expect(res.priceUsd).toBeNull();
    expect(res.source).toBe('unknown');
  });
});

describe('normalizeSwap — exclusions and attribution', () => {
  it('returns null when base moved zero (not a trade)', () => {
    const pool = mkPool(true);
    expect(normalizeSwap(mkDecoded(pool, 0n, -500n), mkCtx(pool, 18, 6))).toBeNull();
  });

  it('returns null when base and quote are the same token (wrap/unwrap-like)', () => {
    const pool = mkPool(true);
    const ctx = mkCtx(pool, 18, 18);
    const sameQuote = { ...ctx, quote: { ...ctx.quote, address: BASE } };
    expect(normalizeSwap(mkDecoded(pool, 1000n, -500n), sameQuote)).toBeNull();
  });

  it('uses recipient as trader; falls back to txFrom when recipient is zero', () => {
    const pool = mkPool(true);
    const viaRecipient = normalizeSwap(mkDecoded(pool, 1n, -1n), mkCtx(pool, 18, 6))!;
    expect(viaRecipient.traderAddress.toLowerCase()).toBe(TRADER.toLowerCase());

    const txFrom = '0x00000000000000000000000000000000000000dd' as Hex;
    const viaFallback = normalizeSwap(
      mkDecoded(pool, 1n, -1n, ZERO),
      mkCtx(pool, 18, 6, { txFrom }),
    )!;
    expect(viaFallback.traderAddress.toLowerCase()).toBe(txFrom.toLowerCase());
  });

  it('trade id is the unique (chain, tx, logIndex) triple', () => {
    const pool = mkPool(true);
    const trade = normalizeSwap(mkDecoded(pool, 1n, -1n), mkCtx(pool, 18, 6))!;
    expect(trade.id).toBe(tradeId(ROBINHOOD_CHAIN_ID, TX, 5));
    expect(trade.id).toContain(String(ROBINHOOD_CHAIN_ID));
  });
});

describe('dedupeLogs', () => {
  const log = (logIndex: number, removed = false): ProviderLog => ({
    address: POOL,
    topics: [BH],
    data: '0x' as Hex,
    blockNumber: 1n,
    blockHash: BH,
    transactionHash: TX,
    logIndex,
    removed,
  });

  it('removes duplicates on (txHash, logIndex), preserving first occurrence order', () => {
    const out = dedupeLogs(ROBINHOOD_CHAIN_ID, [log(1), log(2), log(1), log(2), log(3)]);
    expect(out.map((l) => l.logIndex)).toEqual([1, 2, 3]);
  });

  it('drops reorg-removed logs entirely', () => {
    const out = dedupeLogs(ROBINHOOD_CHAIN_ID, [log(1, true), log(2)]);
    expect(out.map((l) => l.logIndex)).toEqual([2]);
  });

  it('key is case-insensitive on tx hash', () => {
    expect(logKey(1, TX.toUpperCase(), 9)).toBe(logKey(1, TX, 9));
  });
});
