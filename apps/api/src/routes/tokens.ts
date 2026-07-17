import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  tokenListQuerySchema,
  tokenParamSchema,
  timeWindowSchema,
  tradesQuerySchema,
} from '@chainscope/shared';
import { parseOrThrow } from '../lib/validate.js';
import { notFound, validationError } from '../lib/errors.js';
import { isTokenSortKey, TOKEN_SORT_KEYS, type TokenSortKey } from '../services/token-read.js';

const windowQuerySchema = z.object({ window: timeWindowSchema.default('1h') });
const holdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const tokenRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/tokens',
    { schema: { tags: ['tokens'], summary: 'Ranked token list' } },
    async (req) => {
      const q = parseOrThrow(tokenListQuerySchema, req.query, 'query');
      let sort: TokenSortKey = 'opportunityScore';
      if (q.sort !== undefined) {
        if (!isTokenSortKey(q.sort)) {
          throw validationError('Invalid query', [
            { path: 'sort', message: `sort must be one of: ${TOKEN_SORT_KEYS.join(', ')}` },
          ]);
        }
        sort = q.sort;
      }
      return app.services.tokens.list({
        window: q.window,
        ...(q.search !== undefined ? { search: q.search } : {}),
        ...(q.walletClass !== undefined ? { walletClass: q.walletClass } : {}),
        sort,
        order: q.order,
        limit: q.limit,
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
      });
    },
  );

  app.get(
    '/tokens/:address',
    { schema: { tags: ['tokens'], summary: 'Token detail' } },
    async (req) => {
      const { address } = parseOrThrow(tokenParamSchema, req.params, 'params');
      const { window } = parseOrThrow(windowQuerySchema, req.query, 'query');
      const detail = await app.services.tokens.detail(address, window);
      if (!detail) throw notFound(`Token ${address} not found`);
      return detail;
    },
  );

  app.get(
    '/tokens/:address/trades',
    { schema: { tags: ['tokens'], summary: 'Token trades' } },
    async (req) => {
      const { address } = parseOrThrow(tokenParamSchema, req.params, 'params');
      const q = parseOrThrow(tradesQuerySchema, req.query, 'query');
      const res = await app.services.tokens.trades(address, {
        limit: q.limit,
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
        ...(q.side !== undefined ? { side: q.side } : {}),
        ...(q.window !== undefined ? { window: q.window } : {}),
      });
      if (!res) throw notFound(`Token ${address} not found`);
      return res;
    },
  );

  app.get(
    '/tokens/:address/metrics',
    { schema: { tags: ['tokens'], summary: 'Token rolling metrics' } },
    async (req) => {
      const { address } = parseOrThrow(tokenParamSchema, req.params, 'params');
      const { window } = parseOrThrow(windowQuerySchema, req.query, 'query');
      const res = await app.services.tokens.metrics(address, window);
      if (!res) throw notFound(`Token ${address} not found`);
      return res;
    },
  );

  app.get(
    '/tokens/:address/score',
    {
      schema: {
        tags: ['tokens'],
        summary: 'Opportunity + risk score with full breakdown + explanations',
      },
    },
    async (req) => {
      const { address } = parseOrThrow(tokenParamSchema, req.params, 'params');
      const { window } = parseOrThrow(windowQuerySchema, req.query, 'query');
      const res = await app.services.tokens.score(address, window);
      if (!res) throw notFound(`Token ${address} not found`);
      return res;
    },
  );

  app.get(
    '/tokens/:address/holders',
    {
      schema: {
        tags: ['tokens'],
        summary: 'Top holders (from tracked positions) or honest unavailable shape',
      },
    },
    async (req) => {
      const { address } = parseOrThrow(tokenParamSchema, req.params, 'params');
      const { limit } = parseOrThrow(holdersQuerySchema, req.query, 'query');
      const res = await app.services.tokens.holders(address, limit);
      if (!res) throw notFound(`Token ${address} not found`);
      return res;
    },
  );
};
