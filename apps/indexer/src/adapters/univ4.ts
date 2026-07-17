/**
 * Uniswap V4 adapter — interface stub only (SPEC §4; V4 decoder is OUT of round
 * 1 per BUILD_BRIEF). V4 uses a singleton PoolManager with a pool-id keyed
 * `Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128
 * amount1, ...)` event; decoding requires a pool-id → currencies registry that
 * we cannot populate without verified addresses. This class recognizes nothing
 * and decodes nothing, marking the slot NotImplemented rather than faking it.
 */

import { keccak256, toBytes } from 'viem';
import type { Hex } from '@chainscope/shared';
import type { ProviderLog } from '../provider/types.js';
import type { DexAdapter, DecodeContext, DecodedSwap } from './types.js';

export const UNIV4_SWAP_SIGNATURE =
  'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)';

/** Canonical V4 Swap topic0 (kept for future registry work; not yet decoded). */
export const UNIV4_SWAP_TOPIC0: Hex = keccak256(toBytes(UNIV4_SWAP_SIGNATURE));

export const UNIV4_NOT_IMPLEMENTED =
  'Uniswap V4 decoding is not implemented (round 2). Requires a verified ' +
  'PoolManager address and a pool-id → currency mapping.';

export class UniV4Adapter implements DexAdapter {
  readonly kind = 'univ4' as const;
  constructor(readonly dexName: string) {}

  /** Never matches — the slot is a documented placeholder, not a live decoder. */
  matches(_log: ProviderLog): boolean {
    return false;
  }

  decode(_log: ProviderLog, _ctx: DecodeContext): DecodedSwap | null {
    return null;
  }
}
