import { z } from 'zod';

/** Lowercase-normalized 20-byte hex address. */
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed 20-byte hex address');

/**
 * Transaction hash. Accepts real 32-byte hashes and the `0xDEMO…` demo marker
 * so the same schema validates demo and live trades.
 */
export const txHashSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{64}|DEMO[0-9a-fA-F]{60})$/, 'must be a 0x tx hash or 0xDEMO demo hash');

export const timeWindowSchema = z.enum(['1m', '5m', '15m', '1h', '4h', '24h']);
export type TimeWindowInput = z.infer<typeof timeWindowSchema>;

export const walletClassSchema = z.enum([
  'MEGA_WHALE',
  'WHALE',
  'LARGE_TRADER',
  'SMART_MONEY',
  'RETAIL',
  'NEW_WALLET',
  'BOT',
  'DEPLOYER_LINKED',
  'MARKET_MAKER',
  'PROTOCOL',
  'UNKNOWN',
]);

export const tradeSideSchema = z.enum(['BUY', 'SELL']);

/** Decimal integer string (raw onchain amount). */
export const rawAmountSchema = z.string().regex(/^\d+$/, 'must be a non-negative integer string');

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().optional(),
});
