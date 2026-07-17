/**
 * Small ABI/topic helpers shared by the DEX adapters.
 */

import { getAddress, slice } from 'viem';
import type { Hex } from '@chainscope/shared';

/** Decode a 32-byte indexed address topic to a checksummed 20-byte address. */
export function addressFromTopic(topic: Hex | undefined): Hex {
  if (!topic) return '0x0000000000000000000000000000000000000000';
  // Address is right-aligned in the 32-byte word: take the last 20 bytes.
  return getAddress(slice(topic, 12)) as Hex;
}

/** Case-insensitive hex equality (topics/addresses). */
export function isSameAddress(a: Hex | undefined, b: Hex | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}
