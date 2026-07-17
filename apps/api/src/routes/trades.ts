import type { FastifyPluginAsync } from 'fastify';
import { tradesQuerySchema } from '@chainscope/shared';
import { parseOrThrow } from '../lib/validate.js';

export const tradeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/trades/live', { schema: { tags: ['trades'], summary: 'Recent trades feed' } }, async (req) => {
    const q = parseOrThrow(tradesQuerySchema, req.query, 'query');
    return app.services.tokens.tradeFeed({
      limit: q.limit,
      ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      ...(q.side !== undefined ? { side: q.side } : {}),
      ...(q.window !== undefined ? { window: q.window } : {}),
    });
  });
};
