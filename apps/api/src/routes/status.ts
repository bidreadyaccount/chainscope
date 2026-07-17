import type { FastifyPluginAsync } from 'fastify';
import { buildStatus } from '../services/status-read.js';

export const statusRoutes: FastifyPluginAsync = async (app) => {
  app.get('/status', { schema: { tags: ['system'], summary: 'Data + indexer status' } }, async () => {
    const s = app.services;
    return buildStatus({
      prisma: s.prisma,
      redis: s.redis,
      env: s.env,
      ...(s.stream ? { stream: s.stream } : {}),
      startedAt: s.startedAt,
    });
  });
};
