import { z } from 'zod';

export const wsMessageTypeSchema = z.enum([
  'trade',
  'token_metrics',
  'score',
  'rankings',
  'indexer_health',
]);

export const wsEnvelopeSchema = z.object({
  type: wsMessageTypeSchema,
  ts: z.string().datetime(),
  data: z.unknown(),
});

export type WsEnvelopeInput = z.infer<typeof wsEnvelopeSchema>;
