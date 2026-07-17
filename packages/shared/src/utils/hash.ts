/**
 * Deterministic identifiers for demo data.
 *
 * These are intentionally fake and clearly labelled: transaction hashes carry a
 * literal `DEMO` marker so they can never be confused with real onchain hashes
 * (BUILD_BRIEF guardrail: "No fake 'live' labels on demo data"). Addresses are
 * valid 20-byte hex (so viem/address tooling accepts them) but are fully
 * derived from seed inputs — nothing here mimics a real Robinhood Chain entity.
 */

import type { Hex } from '../types/common.js';
import { seedFromString } from './prng.js';

/** Deterministic lowercase hex string of `nBytes` derived from `seed`. */
export function hexStream(seed: string, nBytes: number): string {
  let s = seedFromString(seed) || 1;
  let out = '';
  for (let i = 0; i < nBytes; i++) {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out += (s & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

/** Deterministic, valid-shaped 20-byte demo address. */
export function demoAddress(...parts: (string | number)[]): Hex {
  return `0x${hexStream(`addr:${parts.join(':')}`, 20)}` as Hex;
}

/**
 * Deterministic demo transaction hash. Prefixed with a literal `DEMO` marker
 * (not valid hex on purpose) so it is unmistakably synthetic while keeping the
 * 66-char length of a real hash.
 */
export function demoTxHash(...parts: (string | number)[]): Hex {
  return `0xDEMO${hexStream(`tx:${parts.join(':')}`, 30)}` as Hex;
}

/** Deterministic demo id (opaque string) for trade/entity primary keys. */
export function demoId(prefix: string, ...parts: (string | number)[]): string {
  return `demo_${prefix}_${hexStream(`${prefix}:${parts.join(':')}`, 8)}`;
}
