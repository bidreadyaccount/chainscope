/**
 * DemoProvider — a network-free ChainProvider that synthesizes deterministic
 * blocks containing real, decodable swap logs built from the shared demo
 * generator's trades. Feeding these blocks through the indexer exercises the
 * complete live path (block → getLogs → adapter decode → normalize → pipeline)
 * without any RPC. Determinism: same seed + `now` ⇒ identical blocks/logs.
 */

import {
  generateDemoDataset,
  DEFAULT_SEED,
  type Hex,
  type NormalizedTrade,
} from '@chainscope/shared';
import type {
  ChainProvider,
  GetLogsParams,
  HeadListener,
  ProviderBlock,
  ProviderLog,
  ProviderStatus,
} from './types.js';
import { demoBlockHash, demoPoolConfigs, encodeSwapLog } from '../demo-fixtures.js';
import type { PoolConfig } from '../adapters/types.js';

export interface DemoProviderOptions {
  readonly seed?: number;
  readonly now?: number;
  /** Cap the dataset to the most recent N blocks (bounded runs / fast tests). */
  readonly recentBlocks?: number;
}

export class DemoProvider implements ChainProvider {
  readonly kind = 'demo' as const;
  private readonly seed: number;
  private readonly logsByBlock = new Map<string, ProviderLog[]>();
  private readonly knownBlocks: bigint[] = [];
  private readonly tsByBlock = new Map<string, bigint>();
  private readonly head: bigint;
  private readonly startBlock: bigint;

  constructor(opts: DemoProviderOptions = {}) {
    this.seed = opts.seed ?? DEFAULT_SEED;
    const now = opts.now ?? Date.now();
    const { trades } = generateDemoDataset(this.seed, now);
    const pools = new Map<string, PoolConfig>();
    demoPoolConfigs(this.seed).forEach((p) => pools.set(p.poolAddress.toLowerCase(), p));

    // Group into blocks.
    const byBlock = new Map<bigint, NormalizedTrade[]>();
    for (const t of trades) {
      const arr = byBlock.get(t.blockNumber) ?? [];
      arr.push(t);
      byBlock.set(t.blockNumber, arr);
    }
    let sortedBlocks = [...byBlock.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (opts.recentBlocks && opts.recentBlocks < sortedBlocks.length) {
      sortedBlocks = sortedBlocks.slice(sortedBlocks.length - opts.recentBlocks);
    }

    for (const bn of sortedBlocks) {
      const blockTrades = byBlock.get(bn)!;
      const hash = demoBlockHash(this.seed, bn);
      // Representative timestamp = most recent trade in the block (seconds).
      const tsMs = Math.max(...blockTrades.map((t) => t.blockTimestamp.getTime()));
      this.tsByBlock.set(bn.toString(), BigInt(Math.floor(tsMs / 1000)));
      const logs: ProviderLog[] = [];
      for (const t of blockTrades) {
        const pool = pools.get(t.poolAddress.toLowerCase());
        if (!pool) continue;
        logs.push(encodeSwapLog(t, pool, hash));
      }
      this.logsByBlock.set(bn.toString(), logs);
      this.knownBlocks.push(bn);
    }

    this.startBlock = this.knownBlocks[0] ?? 0n;
    this.head = this.knownBlocks[this.knownBlocks.length - 1] ?? 0n;
  }

  /** First block that carries logs (useful to seed a checkpoint for a run). */
  get firstBlock(): bigint {
    return this.startBlock;
  }

  getBlockNumber(): Promise<bigint> {
    return Promise.resolve(this.head);
  }

  private timestampFor(blockNumber: bigint): bigint {
    const exact = this.tsByBlock.get(blockNumber.toString());
    if (exact !== undefined) return exact;
    // Carry forward the timestamp of the greatest known block <= blockNumber.
    let ts = 0n;
    for (const known of this.knownBlocks) {
      if (known <= blockNumber) ts = this.tsByBlock.get(known.toString()) ?? ts;
      else break;
    }
    return ts;
  }

  getBlock(blockNumber: bigint): Promise<ProviderBlock | null> {
    if (blockNumber < 0n || blockNumber > this.head) return Promise.resolve(null);
    return Promise.resolve({
      number: blockNumber,
      hash: demoBlockHash(this.seed, blockNumber),
      parentHash: demoBlockHash(this.seed, blockNumber - 1n),
      timestamp: this.timestampFor(blockNumber),
    });
  }

  getBlockByHash(hash: Hex): Promise<ProviderBlock | null> {
    for (const bn of this.knownBlocks) {
      if (demoBlockHash(this.seed, bn).toLowerCase() === hash.toLowerCase()) {
        return this.getBlock(bn);
      }
    }
    return Promise.resolve(null);
  }

  getLogs(params: GetLogsParams): Promise<ProviderLog[]> {
    const addrFilter = params.addresses
      ? new Set(params.addresses.map((a) => a.toLowerCase()))
      : null;
    const topicFilter = params.topic0 ? new Set(params.topic0.map((t) => t.toLowerCase())) : null;
    const out: ProviderLog[] = [];
    for (const bn of this.knownBlocks) {
      if (bn < params.fromBlock || bn > params.toBlock) continue;
      for (const log of this.logsByBlock.get(bn.toString()) ?? []) {
        if (addrFilter && !addrFilter.has(log.address.toLowerCase())) continue;
        if (topicFilter && !topicFilter.has((log.topics[0] ?? '0x').toLowerCase())) continue;
        out.push(log);
      }
    }
    return Promise.resolve(out);
  }

  watchHeads(onHead: HeadListener): () => void {
    // Emit the current head once (bounded, synthetic). No polling loop needed.
    const timer = setTimeout(() => onHead(this.head), 0);
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearTimeout(timer);
  }

  status(): ProviderStatus {
    return {
      kind: 'demo',
      transport: 'demo',
      circuit: 'closed',
      consecutiveFailures: 0,
      lastHead: this.head.toString(),
    };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
