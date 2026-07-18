/**
 * Stock-token index-layer routes: curated indexes and the stock-token registry.
 * Read-only analytics/visualization — no custody, trading or order placement.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parseOrThrow } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';

const slugParam = z.object({ slug: z.string().min(1).max(64) });
const tickerParam = z.object({ ticker: z.string().min(1).max(16) });
const stockQuery = z.object({ sector: z.string().min(1).max(64).optional() });

export const indexRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/indexes',
    { schema: { tags: ['indexes'], summary: 'Curated index list' } },
    async () => {
      return app.services.indexes.list();
    },
  );

  app.get(
    '/indexes/:slug',
    {
      schema: {
        tags: ['indexes'],
        summary: 'Index detail (constituents, weights, sector, performance)',
      },
    },
    async (req) => {
      const { slug } = parseOrThrow(slugParam, req.params, 'params');
      const detail = await app.services.indexes.detail(slug);
      if (!detail) throw notFound(`Index ${slug} not found`);
      return detail;
    },
  );

  app.get(
    '/stocks',
    { schema: { tags: ['indexes'], summary: 'Stock-token registry' } },
    async (req) => {
      const q = parseOrThrow(stockQuery, req.query, 'query');
      return app.services.indexes.listStocks(q.sector);
    },
  );

  app.get(
    '/stocks/:ticker',
    { schema: { tags: ['indexes'], summary: 'Stock-token detail' } },
    async (req) => {
      const { ticker } = parseOrThrow(tickerParam, req.params, 'params');
      const detail = await app.services.indexes.stockDetail(ticker);
      if (!detail) throw notFound(`Stock token ${ticker} not found`);
      return detail;
    },
  );
};
