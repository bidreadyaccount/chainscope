/**
 * LiveProvider — a viem-backed {@link ChainProvider} for Robinhood Chain.
 *
 * Transport: an HTTP `PublicClient` (from `ROBINHOOD_RPC_URL`, falling back to
 * the chain-config public RPC) for request/response calls, plus an optional
 * WebSocket client (`ROBINHOOD_WS_URL`) used for `watchBlocks` head
 * subscriptions. When no WS URL is configured — or the subscription errors — the
 * provider falls back to polling `eth_blockNumber` at a configurable interval.
 *
 * Reliability (SPEC §19): every RPC call is wrapped by
 *   1. a circuit breaker (open after N consecutive failures, half-open probe,
 *      close on success) whose state is exposed via {@link status} for the
 *      /status page + indexer_health envelopes, and
 *   2. jittered exponential-backoff retry.
 *
 * The low-level viem client is injected via the {@link RpcClient} seam so the
 * breaker/retry/fallback wiring is unit-testable with zero network. The
 * production factory {@link createViemRpcClient} builds the real clients.
 */

import { createPublicClient, http, webSocket, defineChain, type PublicClient } from 'viem';
import { ROBINHOOD_CHAIN } from '@chainscope/config';
import type { Hex } from '@chainscope/shared';
import type {
  ChainProvider,
  GetLogsParams,
  HeadListener,
  ProviderBlock,
  ProviderLog,
  ProviderStatus,
} from './types.js';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
import { withRetry } from './retry.js';

/**
 * Minimal RPC surface the LiveProvider needs. Injecting this (rather than a
 * concrete viem client) keeps the breaker/retry/fallback logic testable.
 */
export interface RpcClient {
  getBlockNumber(): Promise<bigint>;
  getBlock(blockNumber: bigint): Promise<ProviderBlock | null>;
  getBlockByHash(hash: Hex): Promise<ProviderBlock | null>;
  getLogs(params: GetLogsParams): Promise<ProviderLog[]>;
  /** WS head subscription. Undefined when no WebSocket transport is configured. */
  watchBlocks?: (onHead: HeadListener, onError: (err: unknown) => void) => () => void;
  close(): Promise<void>;
}

export interface LiveProviderOptions {
  /** Consecutive failures that trip the breaker (default 5). */
  readonly failureThreshold?: number;
  /** Breaker cooldown before a half-open probe, ms (default 15s). */
  readonly circuitCooldownMs?: number;
  /** Retries after the first attempt per call (default 4). */
  readonly retries?: number;
  /** Backoff base / cap, ms. */
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  /** Poll interval used when no WS transport is active, ms (default 2s). */
  readonly pollIntervalMs?: number;
  /** Clock/rng/sleep injection for tests. */
  readonly now?: () => number;
  readonly random?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class LiveProvider implements ChainProvider {
  readonly kind = 'live' as const;

  private readonly rpc: RpcClient;
  private readonly breaker: CircuitBreaker;
  private readonly retries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly pollIntervalMs: number;
  private readonly random?: () => number;
  private readonly sleep?: (ms: number) => Promise<void>;

  private lastHead: bigint | null = null;
  private transport: 'ws' | 'http' = 'http';

  constructor(rpc: RpcClient, opts: LiveProviderOptions = {}) {
    this.rpc = rpc;
    this.breaker = new CircuitBreaker({
      failureThreshold: opts.failureThreshold ?? 5,
      cooldownMs: opts.circuitCooldownMs ?? 15_000,
      ...(opts.now ? { now: opts.now } : {}),
    });
    this.retries = opts.retries ?? 4;
    this.backoffBaseMs = opts.backoffBaseMs ?? 200;
    this.backoffMaxMs = opts.backoffMaxMs ?? 8_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 2_000;
    if (opts.random) this.random = opts.random;
    if (opts.sleep) this.sleep = opts.sleep;
  }

  /** Run an RPC call behind the breaker + retry. */
  private async guarded<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.breaker.canRequest()) throw new CircuitOpenError();
    try {
      const result = await withRetry(fn, {
        retries: this.retries,
        baseMs: this.backoffBaseMs,
        maxMs: this.backoffMaxMs,
        // Never retry a fast-fail from an already-open breaker.
        shouldRetry: (err) => !(err instanceof CircuitOpenError),
        ...(this.random ? { random: this.random } : {}),
        ...(this.sleep ? { sleep: this.sleep } : {}),
      });
      this.breaker.recordSuccess();
      return result;
    } catch (err) {
      this.breaker.recordFailure();
      throw err;
    }
  }

  async getBlockNumber(): Promise<bigint> {
    const head = await this.guarded(() => this.rpc.getBlockNumber());
    this.lastHead = head;
    return head;
  }

  getBlock(blockNumber: bigint): Promise<ProviderBlock | null> {
    return this.guarded(() => this.rpc.getBlock(blockNumber));
  }

  getBlockByHash(hash: Hex): Promise<ProviderBlock | null> {
    return this.guarded(() => this.rpc.getBlockByHash(hash));
  }

  getLogs(params: GetLogsParams): Promise<ProviderLog[]> {
    return this.guarded(() => this.rpc.getLogs(params));
  }

  /**
   * Subscribe to new heads. Uses the WS `watchBlocks` subscription when
   * available; on a subscription error (or when no WS transport exists) it falls
   * back to polling `getBlockNumber`.
   */
  watchHeads(onHead: HeadListener, onError?: (err: unknown) => void): () => void {
    let stopped = false;
    let unwatchWs: (() => void) | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const emit = (head: bigint): void => {
      this.lastHead = head;
      onHead(head);
    };

    const startPolling = (): void => {
      if (stopped || pollTimer) return;
      this.transport = 'http';
      const tick = (): void => {
        this.getBlockNumber()
          .then((head) => emit(head))
          .catch((err) => onError?.(err));
      };
      pollTimer = setInterval(tick, this.pollIntervalMs);
      if (typeof pollTimer.unref === 'function') pollTimer.unref();
      tick(); // fire immediately so the first head is not delayed a full interval
    };

    if (this.rpc.watchBlocks) {
      this.transport = 'ws';
      unwatchWs = this.rpc.watchBlocks(emit, (err) => {
        onError?.(err);
        // WS broke — tear it down and fall back to polling.
        if (unwatchWs) {
          unwatchWs();
          unwatchWs = undefined;
        }
        startPolling();
      });
    } else {
      startPolling();
    }

    return () => {
      stopped = true;
      if (unwatchWs) unwatchWs();
      if (pollTimer) clearInterval(pollTimer);
    };
  }

  status(): ProviderStatus {
    const snap = this.breaker.snapshot();
    return {
      kind: 'live',
      transport: this.transport,
      circuit: snap.state,
      consecutiveFailures: snap.consecutiveFailures,
      lastHead: this.lastHead === null ? null : this.lastHead.toString(),
    };
  }

  close(): Promise<void> {
    return this.rpc.close();
  }
}

/**
 * Build a production {@link RpcClient} from viem HTTP (+ optional WS) transports.
 * Never called in tests (LiveProvider takes an injected client there).
 */
export function createViemRpcClient(params: {
  httpUrl?: string | undefined;
  wsUrl?: string | undefined;
  timeoutMs?: number;
}): RpcClient {
  const chain = defineChain({
    id: ROBINHOOD_CHAIN.id,
    name: ROBINHOOD_CHAIN.name,
    nativeCurrency: ROBINHOOD_CHAIN.nativeCurrency,
    rpcUrls: { default: { http: [params.httpUrl ?? ROBINHOOD_CHAIN.defaultRpcUrl] } },
  });
  const timeout = params.timeoutMs ?? 10_000;

  const httpClient: PublicClient = createPublicClient({
    chain,
    transport: http(params.httpUrl ?? ROBINHOOD_CHAIN.defaultRpcUrl, { timeout, retryCount: 0 }),
  });
  const wsClient: PublicClient | undefined = params.wsUrl
    ? createPublicClient({ chain, transport: webSocket(params.wsUrl) })
    : undefined;

  const toBlock = (b: {
    number: bigint | null;
    hash: Hex | null;
    parentHash: Hex;
    timestamp: bigint;
  }): ProviderBlock | null =>
    b.number === null || b.hash === null
      ? null
      : { number: b.number, hash: b.hash, parentHash: b.parentHash, timestamp: b.timestamp };

  const client: RpcClient = {
    getBlockNumber: () => httpClient.getBlockNumber(),
    async getBlock(blockNumber) {
      try {
        const b = await httpClient.getBlock({ blockNumber, includeTransactions: false });
        return toBlock(b);
      } catch {
        return null;
      }
    },
    async getBlockByHash(hash) {
      try {
        const b = await httpClient.getBlock({ blockHash: hash, includeTransactions: false });
        return toBlock(b);
      } catch {
        return null;
      }
    },
    async getLogs(p) {
      const logs = await httpClient.getLogs({
        ...(p.addresses ? { address: [...p.addresses] } : {}),
        fromBlock: p.fromBlock,
        toBlock: p.toBlock,
      });
      const topicSet = p.topic0 ? new Set(p.topic0.map((t) => t.toLowerCase())) : null;
      const out: ProviderLog[] = [];
      for (const l of logs) {
        if (l.blockNumber === null || l.blockHash === null || l.transactionHash === null) continue;
        if (l.logIndex === null) continue;
        const topic0 = (l.topics[0] ?? '0x').toLowerCase();
        if (topicSet && !topicSet.has(topic0)) continue;
        out.push({
          address: l.address as Hex,
          topics: l.topics as readonly Hex[],
          data: l.data as Hex,
          blockNumber: l.blockNumber,
          blockHash: l.blockHash as Hex,
          transactionHash: l.transactionHash as Hex,
          logIndex: l.logIndex,
          ...(l.removed ? { removed: true } : {}),
        });
      }
      return out;
    },
    ...(wsClient
      ? {
          watchBlocks(onHead: HeadListener, onError: (err: unknown) => void): () => void {
            return wsClient.watchBlocks({
              emitMissed: true,
              onBlock: (block) => {
                if (block.number !== null) onHead(block.number);
              },
              onError,
            });
          },
        }
      : {}),
    async close() {
      // viem HTTP transports need no teardown; WS transports close their socket.
      await Promise.resolve();
    },
  };
  return client;
}
