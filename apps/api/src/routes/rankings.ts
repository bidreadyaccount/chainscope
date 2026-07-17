import type { FastifyPluginAsync } from 'fastify';
import { rankingsQuerySchema } from '@chainscope/shared';
import { ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import { parseOrThrow } from '../lib/validate.js';

export const rankingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/rankings', { schema: { tags: ['rankings'], summary: 'Live rankings (Redis sorted sets)' } }, async (req) => {
    // Accept `type` as an alias for `category` (SPEC/brief use `type`).
    const rawQuery = { ...(req.query as Record<string, unknown>) };
    if (rawQuery.category === undefined && rawQuery.type !== undefined) {
      rawQuery.category = rawQuery.type;
    }
    const q = parseOrThrow(rankingsQuerySchema, rawQuery, 'query');
    const entries = await app.services.rankings.read(q.category, q.window, q.limit);

    // Attach token display fields for each ranked address.
    const addresses = entries.map((e) => e.address);
    const tokens = await app.services.prisma.token.findMany({
      where: { chainId: ROBINHOOD_CHAIN_ID, address: { in: addresses } },
      select: { address: true, symbol: true, name: true, decimals: true },
    });
    const byAddress = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));

    const items = entries.map((e) => {
      const t = byAddress.get(e.address.toLowerCase());
      const price = app.services.meta.token(e.address)?.priceUsd ?? null;
      return {
        rank: e.rank,
        value: e.value,
        address: e.address,
        symbol: t?.symbol ?? null,
        name: t?.name ?? null,
        priceUsd: price,
      };
    });

    return { category: q.category, window: q.window, items };
  });
};
