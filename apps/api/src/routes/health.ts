import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', { schema: { tags: ['system'], summary: 'Liveness probe' } }, async () => ({
    status: 'ok',
    service: 'chainscope-api',
    ts: new Date().toISOString(),
  }));
};
