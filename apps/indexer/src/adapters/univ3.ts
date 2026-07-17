/**
 * Uniswap V3-style Swap decoder.
 *
 *   event Swap(
 *     address indexed sender,
 *     address indexed recipient,
 *     int256  amount0,
 *     int256  amount1,
 *     uint160 sqrtPriceX96,
 *     uint128 liquidity,
 *     int24   tick
 *   )
 *
 * amount0/amount1 are *pool-perspective* signed deltas: positive = the pool
 * received the token (trader paid it), negative = the pool sent the token
 * (trader received it). The trader delta is therefore the negation of the pool
 * delta. Direction follows the sign of the base token's trader delta.
 */

import { decodeAbiParameters, keccak256, toBytes } from 'viem';
import type { Hex } from '@chainscope/shared';
import type { ProviderLog } from '../provider/types.js';
import type { DexAdapter, DecodeContext, DecodedSwap } from './types.js';
import { addressFromTopic, isSameAddress } from './abi.js';

export const UNIV3_SWAP_SIGNATURE =
  'Swap(address,address,int256,int256,uint160,uint128,int24)';

/** keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)"). */
export const UNIV3_SWAP_TOPIC0: Hex = keccak256(toBytes(UNIV3_SWAP_SIGNATURE));

const DATA_PARAMS = [
  { name: 'amount0', type: 'int256' },
  { name: 'amount1', type: 'int256' },
  { name: 'sqrtPriceX96', type: 'uint160' },
  { name: 'liquidity', type: 'uint128' },
  { name: 'tick', type: 'int24' },
] as const;

export class UniV3Adapter implements DexAdapter {
  readonly kind = 'univ3' as const;
  constructor(readonly dexName: string) {}

  matches(log: ProviderLog): boolean {
    return isSameAddress(log.topics[0], UNIV3_SWAP_TOPIC0);
  }

  decode(log: ProviderLog, ctx: DecodeContext): DecodedSwap | null {
    if (!this.matches(log)) return null;
    if (log.topics.length < 3) return null;

    const [amount0, amount1] = decodeAbiParameters(DATA_PARAMS, log.data);

    // Pool perspective -> trader perspective is a negation.
    const amount0Delta = -amount0;
    const amount1Delta = -amount1;
    if (amount0Delta === 0n && amount1Delta === 0n) return null;

    const sender = addressFromTopic(log.topics[1]);
    const recipient = addressFromTopic(log.topics[2]);

    return {
      kind: this.kind,
      dexName: this.dexName,
      poolAddress: ctx.pool.poolAddress,
      ...(ctx.pool.routerAddress ? { routerAddress: ctx.pool.routerAddress } : {}),
      token0Address: ctx.pool.token0Address,
      token1Address: ctx.pool.token1Address,
      amount0Delta,
      amount1Delta,
      sender,
      recipient,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
    };
  }
}
