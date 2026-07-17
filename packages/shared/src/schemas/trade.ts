import { z } from 'zod';
import {
  addressSchema,
  txHashSchema,
  tradeSideSchema,
  walletClassSchema,
  rawAmountSchema,
} from './common.js';
import { CHAIN_ID } from '../types/common.js';

/**
 * Wire/API form of NormalizedTrade (SPEC §5): bigint and Date fields are
 * strings. Mirrors `SerializedTrade` in types/trade.ts.
 */
export const serializedTradeSchema = z.object({
  id: z.string().min(1),
  chainId: z.literal(CHAIN_ID),
  transactionHash: txHashSchema,
  logIndex: z.number().int().min(0),
  blockNumber: z.string().regex(/^\d+$/),
  blockTimestamp: z.string().datetime(),

  dexName: z.string().min(1),
  routerAddress: addressSchema.optional(),
  poolAddress: addressSchema,
  traderAddress: addressSchema,

  tokenAddress: addressSchema,
  tokenSymbol: z.string().min(1),
  quoteTokenAddress: addressSchema,
  quoteTokenSymbol: z.string().min(1),

  side: tradeSideSchema,
  tokenAmount: rawAmountSchema,
  quoteAmount: rawAmountSchema,

  priceUsd: z.number().nullable(),
  valueUsd: z.number().nullable(),
  priceConfidence: z.number().min(0).max(100),

  walletClass: walletClassSchema,
  walletClassificationConfidence: z.number().min(0).max(100),

  isDemo: z.boolean(),
});

export type SerializedTradeInput = z.infer<typeof serializedTradeSchema>;
