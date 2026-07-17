import type { FastifyPluginAsync } from 'fastify';
import { notImplemented } from '../lib/errors.js';

/**
 * Round-2 write endpoints (watchlists, watchlist tokens, alerts). Per
 * BUILD_BRIEF these return a structured 501 rather than being stubbed with dead
 * UI. The tables exist in the schema so no migration is needed to enable them.
 */
export const writeRoutes: FastifyPluginAsync = async (app) => {
  const planned = { tags: ['round-2'], summary: 'Planned for round 2 (501)' };

  app.post('/watchlists', { schema: planned }, async () => {
    throw notImplemented();
  });
  app.post('/watchlists/:id/tokens', { schema: planned }, async () => {
    throw notImplemented();
  });
  app.delete('/watchlists/:id/tokens/:address', { schema: planned }, async () => {
    throw notImplemented();
  });
  app.post('/alerts', { schema: planned }, async () => {
    throw notImplemented();
  });
};
