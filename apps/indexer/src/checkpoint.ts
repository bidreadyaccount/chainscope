/**
 * Block checkpointing + reorg safety (SPEC §19; BUILD_BRIEF Phase 4).
 *
 * A single `BlockCheckpoint` row per (chainId, stream) tracks:
 *   - lastIndexedBlock / lastIndexedHash  (tip we have processed)
 *   - lastFinalizedBlock                  (head - CONFIRMATIONS)
 *   - headBlock                           (last observed chain head)
 *   - recentHashes                        (bounded ring of number→hash pairs)
 *
 * The ring lets us detect reorgs and walk back to the last common ancestor. On
 * a detected divergence we delete trades with blockNumber > fork point inside a
 * transaction and reset the checkpoint, so re-processing is clean + idempotent.
 *
 * Note on confirmations: Arbitrum-stack chains have fast *soft* finality, but we
 * still keep the checkpoint behind `head - CONFIRMATIONS` so a reorg of the
 * unconfirmed tip never corrupts persisted trades.
 */

import type { PrismaClient } from '@chainscope/database';
import type { Hex } from '@chainscope/shared';
import type { ChainProvider } from './provider/types.js';

export interface CheckpointConfig {
  readonly chainId: number;
  readonly stream: string;
  /** Max blocks to walk back when reconciling a reorg (default 64). */
  readonly maxReorgDepth?: number;
}

export interface CheckpointSnapshot {
  readonly lastIndexedBlock: bigint;
  readonly lastFinalizedBlock: bigint;
  readonly headBlock: bigint | null;
  readonly lastIndexedHash: Hex | null;
  readonly recentCount: number;
}

type RecentPair = [string, string];

export class CheckpointManager {
  private readonly chainId: number;
  private readonly stream: string;
  private readonly maxReorgDepth: number;

  private ring = new Map<bigint, Hex>();
  private lastIndexedBlock = 0n;
  private lastFinalizedBlock = 0n;
  private headBlock: bigint | null = null;
  private lastIndexedHash: Hex | null = null;
  private loaded = false;

  constructor(
    private readonly prisma: PrismaClient,
    config: CheckpointConfig,
  ) {
    this.chainId = config.chainId;
    this.stream = config.stream;
    this.maxReorgDepth = Math.max(1, config.maxReorgDepth ?? 64);
  }

  /** Read (or create) the checkpoint row and hydrate the in-memory ring. */
  async load(): Promise<CheckpointSnapshot> {
    const row = await this.prisma.blockCheckpoint.upsert({
      where: { chainId_stream: { chainId: this.chainId, stream: this.stream } },
      create: { chainId: this.chainId, stream: this.stream },
      update: {},
    });
    this.lastIndexedBlock = row.lastIndexedBlock;
    this.lastFinalizedBlock = row.lastFinalizedBlock;
    this.headBlock = row.headBlock;
    this.lastIndexedHash = (row.lastIndexedHash as Hex | null) ?? null;
    this.ring = new Map();
    if (Array.isArray(row.recentHashes)) {
      for (const pair of row.recentHashes as RecentPair[]) {
        if (Array.isArray(pair) && pair.length === 2) {
          this.ring.set(BigInt(pair[0]), pair[1] as Hex);
        }
      }
    }
    this.loaded = true;
    return this.snapshot();
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
  getLastIndexedBlock(): bigint {
    return this.lastIndexedBlock;
  }
  getLastFinalizedBlock(): bigint {
    return this.lastFinalizedBlock;
  }
  getHeadBlock(): bigint | null {
    return this.headBlock;
  }
  getLastIndexedHash(): Hex | null {
    return this.lastIndexedHash;
  }
  hashAt(blockNumber: bigint): Hex | undefined {
    return this.ring.get(blockNumber);
  }

  /** The block number we should process next. */
  nextBlock(): bigint {
    return this.lastIndexedBlock + 1n;
  }

  /** Record a processed block hash in the ring, pruning beyond the reorg window. */
  recordBlock(blockNumber: bigint, hash: Hex): void {
    this.ring.set(blockNumber, hash);
    this.pruneRing(blockNumber);
  }

  private pruneRing(tip: bigint): void {
    const cutoff = tip - BigInt(this.maxReorgDepth);
    for (const key of this.ring.keys()) {
      if (key < cutoff) this.ring.delete(key);
    }
  }

  private serializeRing(): RecentPair[] {
    return [...this.ring.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([n, h]) => [n.toString(), h] as RecentPair);
  }

  /**
   * Advance the checkpoint after processing up to `blockNumber` (hash `hash`).
   * `headBlock`/`confirmations` drive the finalized marker.
   */
  async advance(params: {
    blockNumber: bigint;
    hash: Hex;
    headBlock: bigint;
    confirmations: number;
  }): Promise<void> {
    this.recordBlock(params.blockNumber, params.hash);
    this.lastIndexedBlock = params.blockNumber;
    this.lastIndexedHash = params.hash;
    this.headBlock = params.headBlock;
    const finalized = params.headBlock - BigInt(Math.max(0, params.confirmations));
    this.lastFinalizedBlock = finalized > 0n ? finalized : 0n;
    await this.persist();
  }

  /** Persist the current in-memory checkpoint state to the row. */
  async persist(): Promise<void> {
    await this.prisma.blockCheckpoint.update({
      where: { chainId_stream: { chainId: this.chainId, stream: this.stream } },
      data: {
        lastIndexedBlock: this.lastIndexedBlock,
        lastFinalizedBlock: this.lastFinalizedBlock,
        headBlock: this.headBlock,
        lastIndexedHash: this.lastIndexedHash,
        recentHashes: this.serializeRing(),
      },
    });
  }

  /** Update only the observed head (does not move the processed tip). */
  async setHead(headBlock: bigint, confirmations: number): Promise<void> {
    this.headBlock = headBlock;
    const finalized = headBlock - BigInt(Math.max(0, confirmations));
    this.lastFinalizedBlock = finalized > 0n ? finalized : 0n;
    await this.persist();
  }

  /**
   * Detect whether the chain diverged from our recorded history. Returns the
   * fork point (last block whose recorded hash still matches the chain) when a
   * reorg is found, or null when our tip is still canonical. Bounded to
   * `maxReorgDepth`.
   */
  async findForkPoint(provider: ChainProvider): Promise<bigint | null> {
    if (this.lastIndexedBlock === 0n || this.lastIndexedHash === null) return null;

    const tipBlock = await provider.getBlock(this.lastIndexedBlock);
    if (tipBlock && tipBlock.hash.toLowerCase() === this.lastIndexedHash.toLowerCase()) {
      return null; // tip still canonical
    }

    // Walk back to the last block whose recorded hash matches the chain.
    const floor =
      this.lastIndexedBlock > BigInt(this.maxReorgDepth)
        ? this.lastIndexedBlock - BigInt(this.maxReorgDepth)
        : 0n;
    for (let n = this.lastIndexedBlock - 1n; n >= floor && n >= 0n; n -= 1n) {
      const recorded = this.ring.get(n);
      if (!recorded) continue;
      const chainBlock = await provider.getBlock(n);
      if (chainBlock && chainBlock.hash.toLowerCase() === recorded.toLowerCase()) {
        return n; // common ancestor
      }
      if (n === 0n) break;
    }
    // No common ancestor within the bounded window → roll back to the floor.
    return floor;
  }

  /**
   * Roll back to `forkBlock`: delete trades with blockNumber > forkBlock (in a
   * transaction) and reset the checkpoint tip. Returns the number of deleted
   * trades. Idempotent — re-running produces no duplicates.
   */
  async rollbackTo(forkBlock: bigint): Promise<number> {
    const deleted = await this.prisma.$transaction(async (tx) => {
      const res = await tx.trade.deleteMany({
        where: { chainId: this.chainId, blockNumber: { gt: forkBlock } },
      });
      return res.count;
    });

    // Prune the ring above the fork and reset the tip to the fork's hash.
    for (const key of [...this.ring.keys()]) {
      if (key > forkBlock) this.ring.delete(key);
    }
    this.lastIndexedBlock = forkBlock;
    this.lastIndexedHash = this.ring.get(forkBlock) ?? null;
    await this.persist();
    return deleted;
  }

  snapshot(): CheckpointSnapshot {
    return {
      lastIndexedBlock: this.lastIndexedBlock,
      lastFinalizedBlock: this.lastFinalizedBlock,
      headBlock: this.headBlock,
      lastIndexedHash: this.lastIndexedHash,
      recentCount: this.ring.size,
    };
  }
}
