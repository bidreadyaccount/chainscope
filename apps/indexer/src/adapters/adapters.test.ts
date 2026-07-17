/**
 * DEX adapter tests: V2/V3 decoders against hand-built synthetic logs — both
 * directions, both token orderings, zero-amount edges, V3 negative-sign
 * handling — plus registry matching by address AND topic0.
 */
import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, pad } from 'viem';
import type { Hex } from '@chainscope/shared';
import type { ProviderLog } from '../provider/types.js';
import type { PoolConfig } from './types.js';
import { UniV2Adapter, UNIV2_SWAP_TOPIC0 } from './univ2.js';
import { UniV3Adapter, UNIV3_SWAP_TOPIC0 } from './univ3.js';
import { AdapterRegistry } from './registry.js';

// Clearly-fake test addresses (never real deployments).
const POOL = '0x00000000000000000000000000000000000000a1' as Hex;
const TOKEN0 = '0x00000000000000000000000000000000000000b0' as Hex;
const TOKEN1 = '0x00000000000000000000000000000000000000b1' as Hex;
const SENDER = '0x00000000000000000000000000000000000000c1' as Hex;
const TRADER = '0x00000000000000000000000000000000000000d1' as Hex;
const TX = ('0x' + 'ab'.repeat(32)) as Hex;
const BLOCK_HASH = ('0x' + 'cd'.repeat(32)) as Hex;

function pool(kind: 'univ2' | 'univ3', baseIsToken0: boolean): PoolConfig {
  return {
    poolAddress: POOL,
    kind,
    dexName: 'TestDex',
    token0Address: TOKEN0,
    token1Address: TOKEN1,
    baseIsToken0,
  };
}

const V2_PARAMS = [
  { name: 'amount0In', type: 'uint256' },
  { name: 'amount1In', type: 'uint256' },
  { name: 'amount0Out', type: 'uint256' },
  { name: 'amount1Out', type: 'uint256' },
] as const;
const V3_PARAMS = [
  { name: 'amount0', type: 'int256' },
  { name: 'amount1', type: 'int256' },
  { name: 'sqrtPriceX96', type: 'uint160' },
  { name: 'liquidity', type: 'uint128' },
  { name: 'tick', type: 'int24' },
] as const;

function v2Log(a0In: bigint, a1In: bigint, a0Out: bigint, a1Out: bigint): ProviderLog {
  return {
    address: POOL,
    topics: [UNIV2_SWAP_TOPIC0, pad(SENDER, { size: 32 }), pad(TRADER, { size: 32 })],
    data: encodeAbiParameters(V2_PARAMS, [a0In, a1In, a0Out, a1Out]),
    blockNumber: 100n,
    blockHash: BLOCK_HASH,
    transactionHash: TX,
    logIndex: 3,
  };
}

function v3Log(amount0: bigint, amount1: bigint): ProviderLog {
  return {
    address: POOL,
    topics: [UNIV3_SWAP_TOPIC0, pad(SENDER, { size: 32 }), pad(TRADER, { size: 32 })],
    data: encodeAbiParameters(V3_PARAMS, [amount0, amount1, 0n, 0n, 0]),
    blockNumber: 100n,
    blockHash: BLOCK_HASH,
    transactionHash: TX,
    logIndex: 7,
  };
}

describe('UniV2Adapter', () => {
  const adapter = new UniV2Adapter('TestDex');

  it('matches only its topic0', () => {
    expect(adapter.matches(v2Log(1n, 0n, 0n, 2n))).toBe(true);
    expect(adapter.matches(v3Log(1n, -2n))).toBe(false);
  });

  it('decodes trader receiving token1, paying token0 (deltas out - in)', () => {
    // Trader pays 1000 token0, receives 2000 token1.
    const d = adapter.decode(v2Log(1000n, 0n, 0n, 2000n), { pool: pool('univ2', true) });
    expect(d).not.toBeNull();
    expect(d!.amount0Delta).toBe(-1000n);
    expect(d!.amount1Delta).toBe(2000n);
    expect(d!.sender.toLowerCase()).toBe(SENDER.toLowerCase());
    expect(d!.recipient.toLowerCase()).toBe(TRADER.toLowerCase());
  });

  it('decodes the opposite direction', () => {
    const d = adapter.decode(v2Log(0n, 500n, 750n, 0n), { pool: pool('univ2', true) });
    expect(d!.amount0Delta).toBe(750n);
    expect(d!.amount1Delta).toBe(-500n);
  });

  it('returns null for a no-op swap (all zero)', () => {
    expect(adapter.decode(v2Log(0n, 0n, 0n, 0n), { pool: pool('univ2', true) })).toBeNull();
  });

  it('carries pool/token config and log coordinates through', () => {
    const d = adapter.decode(v2Log(1n, 0n, 0n, 2n), { pool: pool('univ2', false) })!;
    expect(d.poolAddress).toBe(POOL);
    expect(d.token0Address).toBe(TOKEN0);
    expect(d.token1Address).toBe(TOKEN1);
    expect(d.transactionHash).toBe(TX);
    expect(d.logIndex).toBe(3);
    expect(d.blockNumber).toBe(100n);
  });
});

describe('UniV3Adapter', () => {
  const adapter = new UniV3Adapter('TestDex');

  it('matches only its topic0', () => {
    expect(adapter.matches(v3Log(1n, -2n))).toBe(true);
    expect(adapter.matches(v2Log(1n, 0n, 0n, 2n))).toBe(false);
  });

  it('negates pool-perspective signed amounts to trader perspective', () => {
    // Pool received 1000 token0 (trader paid), pool sent 2000 token1 (trader received).
    const d = adapter.decode(v3Log(1000n, -2000n), { pool: pool('univ3', true) })!;
    expect(d.amount0Delta).toBe(-1000n);
    expect(d.amount1Delta).toBe(2000n);
  });

  it('handles the opposite sign pairing', () => {
    const d = adapter.decode(v3Log(-750n, 500n), { pool: pool('univ3', true) })!;
    expect(d.amount0Delta).toBe(750n);
    expect(d.amount1Delta).toBe(-500n);
  });

  it('returns null when both deltas are zero', () => {
    expect(adapter.decode(v3Log(0n, 0n), { pool: pool('univ3', true) })).toBeNull();
  });
});

describe('AdapterRegistry', () => {
  it('is empty with no configuration and decodes nothing', () => {
    const reg = new AdapterRegistry([]);
    expect(reg.isEmpty()).toBe(true);
    expect(reg.decode(v2Log(1n, 0n, 0n, 2n))).toBeNull();
  });

  it('matches by BOTH emitting address and topic0', () => {
    const reg = new AdapterRegistry([pool('univ2', true)]);
    expect(reg.size).toBe(1);
    // Right pool + right topic → decodes.
    expect(reg.decode(v2Log(1n, 0n, 0n, 2n))).not.toBeNull();
    // Right pool, wrong topic (V3 event on a V2 pool) → null.
    expect(reg.decode(v3Log(1n, -2n))).toBeNull();
    // Wrong pool address → null.
    const foreign = { ...v2Log(1n, 0n, 0n, 2n), address: TOKEN0 };
    expect(reg.decode(foreign)).toBeNull();
  });

  it('pool address lookup is case-insensitive', () => {
    const reg = new AdapterRegistry([pool('univ2', true)]);
    const upper = { ...v2Log(1n, 0n, 0n, 2n), address: POOL.toUpperCase() as Hex };
    expect(reg.decode(upper)).not.toBeNull();
  });
});
