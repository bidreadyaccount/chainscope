/**
 * WebSocket hub. Clients connect to /ws and subscribe with
 *   { action: "subscribe", channels: [...], tokens?: [...] }
 * (channels are WsMessageType values). The hub subscribes to the Redis pub/sub
 * channels once and fans out each envelope to matching clients. Server->client
 * data frames are the shared envelope { type, ts, data }; control frames
 * (acks/errors) are { ok, ... } / { error: {...} }. Heartbeat ping/pong evicts
 * dead sockets; a connection cap protects the process.
 */

import type { WebSocket } from 'ws';
import type { FastifyBaseLogger } from 'fastify';
import { type WsMessageType } from '@chainscope/shared';
import type { RedisClient } from '../lib/redis.js';
import { WS_CHANNEL_TYPES, wsChannel } from '../lib/keys.js';
import { toErrorBody } from '../lib/errors.js';

const VALID_CHANNELS = new Set<WsMessageType>(WS_CHANNEL_TYPES);
const TOKEN_SCOPED = new Set<WsMessageType>(['trade', 'token_metrics', 'score']);

interface Client {
  readonly socket: WebSocket;
  channels: Set<WsMessageType>;
  tokens: Set<string> | null;
  alive: boolean;
}

export interface WsHubOptions {
  readonly redisSub: RedisClient;
  readonly logger: FastifyBaseLogger;
  readonly maxConnections?: number;
  readonly heartbeatMs?: number;
  readonly maxMessageBytes?: number;
}

export class WsHub {
  private readonly clients = new Set<Client>();
  private readonly redisSub: RedisClient;
  private readonly logger: FastifyBaseLogger;
  private readonly maxConnections: number;
  private readonly heartbeatMs: number;
  private readonly maxMessageBytes: number;
  private heartbeat?: NodeJS.Timeout;
  private started = false;

  constructor(opts: WsHubOptions) {
    this.redisSub = opts.redisSub;
    this.logger = opts.logger;
    this.maxConnections = opts.maxConnections ?? 500;
    this.heartbeatMs = opts.heartbeatMs ?? 30_000;
    this.maxMessageBytes = opts.maxMessageBytes ?? 16 * 1024;
  }

  /** Subscribe to Redis channels and start the heartbeat. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.redisSub.subscribe(...WS_CHANNEL_TYPES.map(wsChannel));
    this.redisSub.on('message', (_channel, payload) => this.fanout(payload));
    this.heartbeat = setInterval(() => this.sweep(), this.heartbeatMs);
    if (typeof this.heartbeat.unref === 'function') this.heartbeat.unref();
  }

  connectionCount(): number {
    return this.clients.size;
  }

  addConnection(socket: WebSocket): void {
    if (this.clients.size >= this.maxConnections) {
      try {
        socket.send(JSON.stringify(toErrorBody('RATE_LIMITED', 'Connection limit reached')));
        socket.close(1013, 'connection limit');
      } catch {
        /* ignore */
      }
      return;
    }
    // Default: subscribed to all channels, all tokens, until the client narrows.
    const client: Client = {
      socket,
      channels: new Set(VALID_CHANNELS),
      tokens: null,
      alive: true,
    };
    this.clients.add(client);

    socket.send(
      JSON.stringify({
        ok: true,
        control: 'welcome',
        channels: [...client.channels],
        note: 'Send { action:"subscribe", channels:[...], tokens?:[...] } to narrow.',
      }),
    );

    socket.on('message', (raw: Buffer) => this.onMessage(client, raw));
    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }

  private onMessage(client: Client, raw: Buffer): void {
    if (raw.length > this.maxMessageBytes) {
      this.sendError(client, 'PAYLOAD_TOO_LARGE', 'Message exceeds size limit');
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      this.sendError(client, 'VALIDATION_ERROR', 'Message must be valid JSON');
      return;
    }
    if (typeof msg !== 'object' || msg === null || !('action' in msg)) {
      this.sendError(client, 'VALIDATION_ERROR', 'Message must include an "action"');
      return;
    }
    const action = (msg as { action: unknown }).action;
    if (action === 'ping') {
      client.socket.send(JSON.stringify({ ok: true, control: 'pong' }));
      return;
    }
    if (action === 'subscribe' || action === 'unsubscribe') {
      const rawChannels = (msg as { channels?: unknown }).channels;
      const channels = Array.isArray(rawChannels)
        ? rawChannels.filter((c): c is WsMessageType => VALID_CHANNELS.has(c as WsMessageType))
        : [];
      if (channels.length === 0) {
        this.sendError(client, 'VALIDATION_ERROR', 'channels must be a non-empty array of valid channel names');
        return;
      }
      if (action === 'subscribe') {
        client.channels = new Set(channels);
        const rawTokens = (msg as { tokens?: unknown }).tokens;
        client.tokens =
          Array.isArray(rawTokens) && rawTokens.length > 0
            ? new Set(rawTokens.map((t) => String(t).toLowerCase()))
            : null;
      } else {
        for (const c of channels) client.channels.delete(c);
      }
      client.socket.send(
        JSON.stringify({
          ok: true,
          control: action === 'subscribe' ? 'subscribed' : 'unsubscribed',
          channels: [...client.channels],
          tokens: client.tokens ? [...client.tokens] : null,
        }),
      );
      return;
    }
    this.sendError(client, 'VALIDATION_ERROR', `Unknown action: ${String(action)}`);
  }

  private fanout(payload: string): void {
    let type: WsMessageType | undefined;
    let tokenAddress: string | undefined;
    try {
      const parsed = JSON.parse(payload) as { type?: WsMessageType; data?: { tokenAddress?: string } };
      type = parsed.type;
      tokenAddress = parsed.data?.tokenAddress;
    } catch {
      return;
    }
    if (!type || !VALID_CHANNELS.has(type)) return;
    for (const client of this.clients) {
      if (!client.channels.has(type)) continue;
      if (TOKEN_SCOPED.has(type) && client.tokens && tokenAddress) {
        if (!client.tokens.has(tokenAddress.toLowerCase())) continue;
      }
      try {
        client.socket.send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private sweep(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        try {
          client.socket.terminate();
        } catch {
          /* ignore */
        }
        this.clients.delete(client);
        continue;
      }
      client.alive = false;
      try {
        client.socket.ping();
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private sendError(client: Client, code: Parameters<typeof toErrorBody>[0], message: string): void {
    try {
      client.socket.send(JSON.stringify(toErrorBody(code, message)));
    } catch {
      /* ignore */
    }
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.clients) {
      try {
        client.socket.close(1001, 'server shutting down');
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    try {
      await this.redisSub.unsubscribe(...WS_CHANNEL_TYPES.map(wsChannel));
    } catch {
      /* ignore */
    }
  }
}
