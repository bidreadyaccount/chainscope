import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { loadEnv, resetEnvCache } from '@chainscope/config';
import { buildServer } from '../server.js';

let app: FastifyInstance;

beforeAll(async () => {
  resetEnvCache();
  app = await buildServer({ env: loadEnv() });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

/** Connect with the message listener attached before any frame flows (onInit). */
async function connect(): Promise<{ ws: WebSocket; messages: unknown[] }> {
  const messages: unknown[] = [];
  const ws = (await app.injectWS('/ws', undefined, {
    onInit: (w) => {
      w.on('message', (raw: Buffer) => {
        try {
          messages.push(JSON.parse(raw.toString('utf8')));
        } catch {
          messages.push({ raw: raw.toString('utf8') });
        }
      });
    },
  })) as unknown as WebSocket;
  return { ws, messages };
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('WebSocket stream', () => {
  it('connects, subscribes, and receives a published trade envelope', async () => {
    const { ws, messages } = await connect();
    await waitFor(() => messages.find((m) => (m as { control?: string }).control === 'welcome'));

    ws.send(JSON.stringify({ action: 'subscribe', channels: ['trade'] }));
    await waitFor(() => messages.find((m) => (m as { control?: string }).control === 'subscribed'));

    await app.services.pubsub.publish('trade', { tokenAddress: '0x' + 'a'.repeat(40), demo: true });

    const envelope = await waitFor(() =>
      messages.find((m) => (m as { type?: string }).type === 'trade'),
    );
    expect((envelope as { type: string; ts: string }).type).toBe('trade');
    expect(typeof (envelope as { ts: string }).ts).toBe('string');
    ws.close();
  });

  it('rejects invalid (non-JSON) messages with a structured error frame', async () => {
    const { ws, messages } = await connect();
    await waitFor(() => messages.find((m) => (m as { control?: string }).control === 'welcome'));

    ws.send('this is not json');
    const err = await waitFor(() => messages.find((m) => (m as { error?: unknown }).error));
    expect((err as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
    ws.close();
  });
});
