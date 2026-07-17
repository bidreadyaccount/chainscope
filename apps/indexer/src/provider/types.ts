/**
 * ChainProvider abstraction (Phase 4). Two implementations exist: a viem-backed
 * `LiveProvider` (RPC/WebSocket) and a network-free `DemoProvider` that
 * synthesizes deterministic blocks + swap logs from the shared demo generator.
 * The indexer main loop is written against this interface only, so the entire
 * ingestion path (block → logs → decode → normalize → pipeline) is exercised in
 * tests with zero network access.
 */

import type { Hex } from '@chainscope/shared';

/** A raw event log, shaped like an `eth_getLogs` entry (viem `Log`). */
export interface ProviderLog {
  readonly address: Hex;
  /** topic0 (event signature hash) followed by any indexed topics. */
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: Hex;
  readonly logIndex: number;
  /** True when the log was removed by a reorg (viem sets this on subscriptions). */
  readonly removed?: boolean;
}

/** Minimal block header the indexer needs (reorg detection + timestamps). */
export interface ProviderBlock {
  readonly number: bigint;
  readonly hash: Hex;
  readonly parentHash: Hex;
  /** Unix seconds (as returned by the RPC). */
  readonly timestamp: bigint;
}

export type CircuitStateName = 'closed' | 'open' | 'half_open';

export interface ProviderStatus {
  readonly kind: 'live' | 'demo';
  /** Active transport: WebSocket subscription, HTTP polling, or synthetic. */
  readonly transport: 'ws' | 'http' | 'demo';
  readonly circuit: CircuitStateName;
  readonly consecutiveFailures: number;
  readonly lastHead: string | null;
}

export interface GetLogsParams {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  /** Restrict to these contract addresses (registered pools). */
  readonly addresses?: readonly Hex[];
  /** topic0 filter (OR of the given event signature hashes). */
  readonly topic0?: readonly Hex[];
}

/** Callback fired with the latest observed head block number. */
export type HeadListener = (head: bigint) => void;

export interface ChainProvider {
  readonly kind: 'live' | 'demo';

  /** Current chain head block number. */
  getBlockNumber(): Promise<bigint>;

  /** Fetch a block header by number (null if not yet available). */
  getBlock(blockNumber: bigint): Promise<ProviderBlock | null>;

  /** Fetch a block header by hash (used during reorg ancestor walks). */
  getBlockByHash(hash: Hex): Promise<ProviderBlock | null>;

  /** Page logs over a bounded block range. */
  getLogs(params: GetLogsParams): Promise<ProviderLog[]>;

  /**
   * Subscribe to new heads. Uses a WebSocket subscription when available and
   * falls back to polling otherwise. Returns an unsubscribe function.
   */
  watchHeads(onHead: HeadListener, onError?: (err: unknown) => void): () => void;

  status(): ProviderStatus;

  close(): Promise<void>;
}
