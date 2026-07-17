import { Redis } from 'ioredis';

export type RedisClient = Redis;

/**
 * Create an ioredis client. A single connection is used for commands; a
 * dedicated second connection is required for pub/sub subscription (ioredis
 * forbids running normal commands on a subscriber connection).
 */
export function createRedis(url: string, opts: { keyPrefix?: string } = {}): Redis {
  return new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    ...(opts.keyPrefix ? { keyPrefix: opts.keyPrefix } : {}),
  });
}
