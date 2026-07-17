/** 0x-prefixed hex string (addresses, tx hashes). */
export type Hex = `0x${string}`;

/** Robinhood Chain id — the only supported chain in round 1. */
export const CHAIN_ID = 4663 as const;
export type ChainId = typeof CHAIN_ID;
