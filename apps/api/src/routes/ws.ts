import type { FastifyPluginAsync } from 'fastify';

/**
 * WebSocket endpoint. Connection lifecycle + protocol live in the WsHub; this
 * just wires each upgraded socket into it. The hub is already subscribed to
 * Redis pub/sub, so a connected client receives fanout envelopes immediately.
 */
export const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/ws', { websocket: true, schema: { tags: ['ws'], summary: 'Live WebSocket stream' } }, (socket) => {
    app.services.wsHub.addConnection(socket);
  });
};
