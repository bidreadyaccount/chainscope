/**
 * Normalized trade model — SPEC §5 verbatim.
 *
 * Numeric-safety (BUILD_BRIEF §5): raw onchain quantities are `bigint` in code
 * (`blockNumber`) and `string` on the wire (`tokenAmount`, `quoteAmount`).
 * JS `number` is used only for derived USD values and confidences.
 */

import type { WalletClass } from './wallet.js';

export type TradeSide = 'BUY' | 'SELL';

export type NormalizedTrade = {
  id: string;
  chainId: 4663;
  transactionHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;

  dexName: string;
  routerAddress?: `0x${string}`;
  poolAddress: `0x${string}`;
  traderAddress: `0x${string}`;

  tokenAddress: `0x${string}`;
  tokenSymbol: string;
  quoteTokenAddress: `0x${string}`;
  quoteTokenSymbol: string;

  side: 'BUY' | 'SELL';
  tokenAmount: string;
  quoteAmount: string;

  priceUsd: number | null;
  valueUsd: number | null;
  priceConfidence: number;

  walletClass: WalletClass;
  walletClassificationConfidence: number;

  isDemo: boolean;
};

/**
 * Wire-safe NormalizedTrade: `bigint` and `Date` fields become strings. This is
 * what the REST/WS layer emits (see the BigInt-safe serializer).
 */
export type SerializedTrade = Omit<NormalizedTrade, 'blockNumber' | 'blockTimestamp'> & {
  blockNumber: string;
  blockTimestamp: string;
};
