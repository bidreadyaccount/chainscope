import type { FastifyPluginAsync } from 'fastify';
import { healthRoutes } from './health.js';
import { statusRoutes } from './status.js';
import { tokenRoutes } from './tokens.js';
import { rankingRoutes } from './rankings.js';
import { tradeRoutes } from './trades.js';
import { walletRoutes } from './wallets.js';
import { methodologyRoutes } from './methodology.js';
import { writeRoutes } from './writes.js';

/**
 * All REST endpoints, registered without a prefix. buildServer mounts this
 * plugin twice: once under `/api/v1` (versioned, canonical) and once under
 * `/api` (unversioned alias for the SPEC §17 paths). See PHASE_3.md.
 */
export const apiRoutes: FastifyPluginAsync = async (app) => {
  await app.register(healthRoutes);
  await app.register(statusRoutes);
  await app.register(tokenRoutes);
  await app.register(rankingRoutes);
  await app.register(tradeRoutes);
  await app.register(walletRoutes);
  await app.register(methodologyRoutes);
  await app.register(writeRoutes);
};
