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

// Canonicalize a ticker: trim surrounding whitespace and uppercase, then require
// 1..16 chars AFTER trimming (audit F-02 — `' AAPL'`/`'AAPL '` must equal `'AAPL'`
// so duplicate detection and DB lookup can't be bypassed with padding).
const tickerSchema = z
  .string()
  .max(64)
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().min(1).max(16));

// Input consistency guard (audit R-03/F-02): case- and whitespace-insensitive
// duplicate rejection, and every manual-weight ticker must appear in `tickers`.
const previewBody = z
  .object({
    tickers: z.array(tickerSchema).min(1).max(100),
    methodology: z.enum(INDEX_METHODOLOGIES).optional(),
    manualWeights: z
      .array(z.object({ ticker: tickerSchema, weight: z.number().finite().positive() }))
      .max(100)
      .optional(),
    maxWeightBps: z.number().int().min(1).max(10000).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    // body.tickers / manualWeights[].ticker are already trimmed + uppercased.
    if (hasDupes(body.tickers)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tickers'],
        message: 'Duplicate tickers are not allowed',
      });
    }
    if (body.manualWeights) {
      const mw = body.manualWeights.map((w) => w.ticker);
      if (hasDupes(mw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['manualWeights'],
          message: 'Duplicate tickers in manualWeights are not allowed',
        });
      }
      const inTickers = new Set(body.tickers);
      const orphans = mw.filter((t) => !inTickers.has(t));
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
  // Minimum one cent: allocations are apportioned in integer cents, so a sub-cent
  // amount cannot be represented and would report $0 against a positive request
  // (audit F-06). The web form already enforces a $1 minimum.
  amount: z.coerce.number().finite().min(0.01).max(1_000_000_000),
});

// Trade-plan preview input (buyable layer). BUY needs an amount; SELL/REBALANCE need
// the current holdings. Tickers are canonicalized the same way as the builder.
const planBody = z
  .object({
    action: z.enum(['BUY', 'SELL', 'REBALANCE']),
    amountUsd: z.number().finite().positive().max(1_000_000_000).optional(),
    holdings: z
      .array(z.object({ ticker: tickerSchema, qty: z.number().finite().nonnegative() }))
      .max(200)
      .optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.action === 'BUY' && (b.amountUsd === undefined || b.amountUsd <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amountUsd'],
        message: 'amountUsd is required for a BUY plan',
      });
    }
    if ((b.action === 'SELL' || b.action === 'REBALANCE') && (b.holdings?.length ?? 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['holdings'],
        message: 'holdings are required for a SELL or REBALANCE plan',
      });
    }
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

  // Trade-plan preview for the buyable layer — read-only, no order is placed.
  app.post(
    '/indexes/:slug/plan',
    { schema: { tags: ['indexes'], summary: 'Preview a buy/sell/rebalance trade plan (read-only)' } },
    async (req) => {
      const { slug } = parseOrThrow(slugParam, req.params, 'params');
      const body = parseOrThrow(planBody, req.body, 'body');
      const plan = await app.services.indexes.plan(slug, body);
      if (!plan) throw notFound(`Index ${slug} not found`);
      return plan;
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
