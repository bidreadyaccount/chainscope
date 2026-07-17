/**
 * DEX adapter framework (Phase 4, SPEC §4). An adapter recognizes and decodes a
 * protocol's Swap event into a protocol-agnostic `DecodedSwap` expressed from
 * the *trader's* perspective (signed token deltas). Normalization then maps the
 * deltas to base/quote using the pool's configuration.
 *
 * Only swaps from configured pools/routers are treated as trades — a raw ERC-20
 * Transfer is never a trade (SPEC §4).
 */

import type { Hex } from '@chainscope/shared';
import type { ProviderLog } from '../provider/types.js';

export type DexKind = 'univ2' | 'univ3' | 'univ4';

/** Pool configuration supplied via env/DB (SPEC §4). Addresses are never invented. */
export interface PoolConfig {
  readonly poolAddress: Hex;
  readonly kind: DexKind;
  readonly dexName: string;
  readonly routerAddress?: Hex;
  readonly token0Address: Hex;
  readonly token1Address: Hex;
  /** Which side is the "base" token being priced/traded. */
  readonly baseIsToken0: boolean;
}

/**
 * Protocol-agnostic decoded swap. `amount0Delta`/`amount1Delta` are the *net*
 * raw amounts credited to the trader: positive = trader received the token,
 * negative = trader paid it. Zero on a side means that token was untouched.
 */
export interface DecodedSwap {
  readonly kind: DexKind;
  readonly dexName: string;
  readonly poolAddress: Hex;
  readonly routerAddress?: Hex;
  readonly token0Address: Hex;
  readonly token1Address: Hex;
  readonly amount0Delta: bigint;
  readonly amount1Delta: bigint;
  /** Swap initiator (indexed `sender`; usually a router). */
  readonly sender: Hex;
  /** Recipient of the output (`to`/`recipient`); the effective trader when present. */
  readonly recipient: Hex;
  readonly logIndex: number;
  readonly transactionHash: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
}

export interface DecodeContext {
  readonly pool: PoolConfig;
}

export interface DexAdapter {
  readonly dexName: string;
  readonly kind: DexKind;
  /** Cheap topic0 check — does this log look like this adapter's Swap event? */
  matches(log: ProviderLog): boolean;
  /** Decode a matching log, or null if it cannot be decoded / is a no-op. */
  decode(log: ProviderLog, ctx: DecodeContext): DecodedSwap | null;
}
