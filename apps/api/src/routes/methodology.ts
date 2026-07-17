import type { FastifyPluginAsync } from 'fastify';
import { buildMethodology } from '../services/methodology.js';

const METHODOLOGY = buildMethodology();

export const methodologyRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/methodology',
    {
      schema: {
        tags: ['methodology'],
        summary: 'Structured methodology (labels, metrics, formulas)',
      },
    },
    async () => METHODOLOGY,
  );
};
