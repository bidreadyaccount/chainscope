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

const INDEX_METHODOLOGIES = ['EQUAL', 'MARKET_CAP', 'PRICE', 'INVERSE_VOL', 'CAP_CAPPED'] as const;

const hasDupes = (xs: string[]): boolean => new Set(xs).size !== xs.length;

// Input consistency guard (audit R-03 + hardening note): reject case-insensitive
// duplicate tickers, and require every manual-weight ticker to appear in `tickers`
// (no silently-filtered manual entries).
const previewBody = z
  .object({
    tickers: z.array(z.string().min(1).max(16)).min(1).max(100),
    methodology: z.enum(INDEX_METHODOLOGIES).optional(),
    manualWeights: z
      .array(
        z.object({ ticker: z.string().min(1).max(16), weight: z.number().finite().positive() }),
      )
      .max(100)
      .optional(),
    maxWeightBps: z.number().int().min(1).max(10000).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const tickersUpper = body.tickers.map((t) => t.toUpperCase());
    if (hasDupes(tickersUpper)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tickers'],
        message: 'Duplicate tickers are not allowed',
      });
    }
    if (body.manualWeights) {
      const mwUpper = body.manualWeights.map((w) => w.ticker.toUpperCase());
      if (hasDupes(mwUpper)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['manualWeights'],
          message: 'Duplicate tickers in manualWeights are not allowed',
        });
      }
      const inTickers = new Set(tickersUpper);
      const orphans = mwUpper.filter((t) => !inTickers.has(t));
      if (orphans.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['manualWeights'],
          message: `manualWeights tickers must all be listed in tickers: ${[...new Set(orphans)].join(', ')}`,
        });
      }
    }
  });
const simulateQuery = z.object({
  amount: z.coerce.number().finite().positive().max(1_000_000_000),
});

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

  // Custom index builder preview — compute-only, no persistence.
  app.post(
    '/indexes/preview',
    { schema: { tags: ['indexes'], summary: 'Preview custom index weights (builder)' } },
    async (req) => {
      const body = parseOrThrow(previewBody, req.body, 'body');
      return app.services.indexes.preview(body);
    },
  );

  // Portfolio simulator for an existing index — read-only, no order placed.
  app.get(
    '/indexes/:slug/simulate',
    { schema: { tags: ['indexes'], summary: 'Simulate an investment in an index' } },
    async (req) => {
      const { slug } = parseOrThrow(slugParam, req.params, 'params');
      const { amount } = parseOrThrow(simulateQuery, req.query, 'query');
      const sim = await app.services.indexes.simulate(slug, amount);
      if (!sim) throw notFound(`Index ${slug} not found`);
      return sim;
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
