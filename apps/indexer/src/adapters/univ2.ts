/**
 * Uniswap V2-style Swap decoder.
 *
 *   event Swap(
 *     address indexed sender,
 *     uint256 amount0In,
 *     uint256 amount1In,
 *     uint256 amount0Out,
 *     uint256 amount1Out,
 *     address indexed to
 *   )
 *
 * topic0 = keccak256 of the canonical signature. Direction is derived from
 * amount{0,1}In vs amount{0,1}Out: the trader pays the "In" tokens and receives
 * the "Out" tokens, so the trader delta for token N is `outN - inN`.
 */

import { decodeAbiParameters, keccak256, toBytes } from 'viem';
import type { Hex } from '@chainscope/shared';
import type { ProviderLog } from '../provider/types.js';
import type { DexAdapter, DecodeContext, DecodedSwap } from './types.js';
import { addressFromTopic, isSameAddress } from './abi.js';

export const UNIV2_SWAP_SIGNATURE = 'Swap(address,uint256,uint256,uint256,uint256,address)';

/** keccak256("Swap(address,uint256,uint256,uint256,uint256,address)"). */
export const UNIV2_SWAP_TOPIC0: Hex = keccak256(toBytes(UNIV2_SWAP_SIGNATURE));

const DATA_PARAMS = [
  { name: 'amount0In', type: 'uint256' },
  { name: 'amount1In', type: 'uint256' },
  { name: 'amount0Out', type: 'uint256' },
  { name: 'amount1Out', type: 'uint256' },
] as const;

export class UniV2Adapter implements DexAdapter {
  readonly kind = 'univ2' as const;
  constructor(readonly dexName: string) {}

  matches(log: ProviderLog): boolean {
    return isSameAddress(log.topics[0], UNIV2_SWAP_TOPIC0);
  }

  decode(log: ProviderLog, ctx: DecodeContext): DecodedSwap | null {
    if (!this.matches(log)) return null;
    if (log.topics.length < 3) return null;

    const [amount0In, amount1In, amount0Out, amount1Out] = decodeAbiParameters(
      DATA_PARAMS,
      log.data,
    );

    const amount0Delta = amount0Out - amount0In;
    const amount1Delta = amount1Out - amount1In;
    // No-op swap (nothing moved) — not a trade.
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
