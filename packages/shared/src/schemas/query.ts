import { z } from 'zod';
import { timeWindowSchema, walletClassSchema, addressSchema } from './common.js';

/** Ranking categories (SPEC §13). */
export const rankingCategorySchema = z.enum([
  'opportunity',
  'smart_money_buying',
  'whale_accumulation',
  'whale_selling',
  'retail_momentum',
  'new_wallet_surge',
  'unusual_volume',
  'liquidity_growth',
  'deployer_selling',
  'coordinated_wallets',
  'strongest_distribution',
  'highest_risk',
]);
export type RankingCategory = z.infer<typeof rankingCategorySchema>;

export const rankingsQuerySchema = z.object({
  category: rankingCategorySchema.default('opportunity'),
  window: timeWindowSchema.default('1h'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const tokenListQuerySchema = z.object({
  window: timeWindowSchema.default('1h'),
  search: z.string().trim().max(100).optional(),
  walletClass: walletClassSchema.optional(),
  sort: z.string().max(50).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const tokenParamSchema = z.object({ address: addressSchema });
export const walletParamSchema = z.object({ address: addressSchema });

export const tradesQuerySchema = z.object({
  window: timeWindowSchema.optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
