/**
 * Redis pub/sub publisher for WS fanout. Publishes BigInt-safe JSON envelopes
 * ({ type, ts, data }) on `cs:ws:{type}` channels; the WS hub subscribes and
 * fans out to connected clients. Using Redis pub/sub (not an in-process
 * emitter) means Phase 4's indexer can publish from a separate process.
 */

import { wsEnvelope, stringifyForWire, type WsMessageType } from '@chainscope/shared';
import type { RedisClient } from '../lib/redis.js';
import { wsChannel } from '../lib/keys.js';

export class PubSub {
  constructor(private readonly redis: RedisClient) {}

  async publish<T>(type: WsMessageType, data: T, ts: Date = new Date()): Promise<void> {
    const envelope = wsEnvelope(type, data, ts);
    await this.redis.publish(wsChannel(type), stringifyForWire(envelope));
  }
}
