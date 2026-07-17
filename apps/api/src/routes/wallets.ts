import type { FastifyPluginAsync } from 'fastify';
import { walletParamSchema, tradesQuerySchema } from '@chainscope/shared';
import { parseOrThrow } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';

export const walletRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/wallets/:address',
    { schema: { tags: ['wallets'], summary: 'Wallet detail (labels, P&L, bot probability)' } },
    async (req) => {
      const { address } = parseOrThrow(walletParamSchema, req.params, 'params');
      const res = await app.services.wallets.detail(address);
      if (!res) throw notFound(`Wallet ${address} not found`);
      return res;
    },
  );

  app.get(
    '/wallets/:address/trades',
    { schema: { tags: ['wallets'], summary: 'Wallet trades' } },
    async (req) => {
      const { address } = parseOrThrow(walletParamSchema, req.params, 'params');
      const q = parseOrThrow(tradesQuerySchema, req.query, 'query');
      // 404 if wallet unknown; empty feed otherwise.
      if (!(await app.services.wallets.exists(address)))
        throw notFound(`Wallet ${address} not found`);
      return app.services.tokens.tradeFeed({
        traderAddress: address,
        limit: q.limit,
        ...(q.cursor !== undefined ? { cursor: q.cursor } : {}),
        ...(q.side !== undefined ? { side: q.side } : {}),
        ...(q.window !== undefined ? { window: q.window } : {}),
      });
    },
  );

  app.get(
    '/wallets/:address/positions',
    { schema: { tags: ['wallets'], summary: 'Wallet positions' } },
    async (req) => {
      const { address } = parseOrThrow(walletParamSchema, req.params, 'params');
      const res = await app.services.wallets.positions(address);
      if (!res) throw notFound(`Wallet ${address} not found`);
      return res;
    },
  );

  app.get(
    '/wallets/:address/relationships',
    { schema: { tags: ['wallets'], summary: 'Wallet relationships' } },
    async (req) => {
      const { address } = parseOrThrow(walletParamSchema, req.params, 'params');
      const res = await app.services.wallets.relationships(address);
      if (!res) throw notFound(`Wallet ${address} not found`);
      return res;
    },
  );
};
