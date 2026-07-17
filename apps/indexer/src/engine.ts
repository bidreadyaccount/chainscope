/**
 * Indexer engine — the live-mode ingestion loop (BUILD_BRIEF Phase 4).
 *
 * Per processed block:
 *   getBlock(n) → getLogs(registered pools) → dedupe → adapter.decode →
 *   normalizeSwap → Pipeline.ingest → checkpoint.advance(hash).
 *
 * The loop only advances up to `head − CONFIRMATIONS`, and on every catch-up it
 * first reconciles reorgs: if the recorded hash at the checkpoint tip no longer
 * matches the chain, it walks back to the last common ancestor, deletes trades
 * beyond the fork inside a transaction, and resets the checkpoint — so the range
 * is reprocessed cleanly. Idempotency is guaranteed twice over: batch-level
 * de-dup on (chainId, txHash, logIndex) and the pipeline's upsert on the same
 * key, so re-running any range produces no duplicates.
 *
 * The engine is written entirely against the {@link ChainProvider} interface, so
 * the whole path runs in tests against the network-free DemoProvider.
 */

import { ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import type { Hex, NormalizedTrade } from '@chainscope/shared';
import type { Pipeline } from '@chainscope/api/pipeline/pipeline.js';
import type { PubSub } from '@chainscope/api/services/pubsub.js';
import type { ChainProvider } from './provider/types.js';
import type { AdapterRegistry } from './adapters/registry.js';
import { type CheckpointManager } from './checkpoint.js';
import { dedupeLogs } from './dedupe.js';
import { normalizeSwap } from './normalize.js';
import { UNIV2_SWAP_TOPIC0 } from './adapters/univ2.js';
import { UNIV3_SWAP_TOPIC0 } from './adapters/univ3.js';
import type { RuntimeConfig } from './runtime-config.js';
import type { IndexerErrorRecorder, Logger } from './errors.js';

/** topic0 filter for the getLogs call — the decodable Swap events (V2, V3). */
export const SWAP_TOPIC0S: readonly Hex[] = [UNIV2_SWAP_TOPIC0, UNIV3_SWAP_TOPIC0];

export interface EngineDeps {
  readonly provider: ChainProvider;
  readonly runtime: RuntimeConfig;
  readonly checkpoint: CheckpointManager;
  readonly pipeline: Pipeline;
  readonly pubsub: PubSub;
  readonly errors: IndexerErrorRecorder;
  readonly logger: Logger;
  readonly confirmations: number;
  readonly clock?: () => number;
}

export interface CatchUpResult {
  readonly processedBlocks: number;
  readonly ingestedTrades: number;
  readonly head: bigint;
  readonly target: bigint;
  readonly reorgDeleted: number;
}

export class IndexerEngine {
  private readonly p: EngineDeps;
  private readonly clock: () => number;
  private ingestedTotal = 0;
  private lastTradeAtMs: number | null = null;
  private stopWatch?: () => void;
  private catchingUp = false;
  private pending = false;

  constructor(deps: EngineDeps) {
    this.p = deps;
    this.clock = deps.clock ?? Date.now;
  }

  get totalIngested(): number {
    return this.ingestedTotal;
  }

  /** Reconcile a possible reorg before processing. Returns deleted-trade count. */
  private async reconcile(): Promise<number> {
    const fork = await this.p.checkpoint.findForkPoint(this.p.provider);
    if (fork === null) return 0;
    const deleted = await this.p.checkpoint.rollbackTo(fork);
    await this.p.errors.record({
      context: 'reorg',
      message: `reorg detected — rolled back to block ${fork.toString()}, deleted ${deleted} trades`,
      blockNumber: fork,
      severity: 'warn',
    });
    return deleted;
  }

  /**
   * Resolve base/quote metadata for a pool and normalize one decoded swap.
   * Returns null (and records an error) when token metadata is missing.
   */
  private async normalizeOne(
    decoded: NonNullable<ReturnType<AdapterRegistry['decode']>>,
    blockTimestamp: Date,
  ): Promise<NormalizedTrade | null> {
    const entry = this.p.runtime.registry.entryFor(decoded.poolAddress);
    if (!entry) return null;
    const pool = entry.pool;
    const baseAddr = pool.baseIsToken0 ? pool.token0Address : pool.token1Address;
    const quoteAddr = pool.baseIsToken0 ? pool.token1Address : pool.token0Address;

    const [base, quote] = await Promise.all([
      this.p.runtime.metaResolver.resolve(baseAddr),
      this.p.runtime.metaResolver.resolve(quoteAddr),
    ]);
    if (!base || !quote) {
      await this.p.errors.record({
        context: 'metadata',
        message: `unknown token metadata for pool ${pool.poolAddress} (base=${baseAddr} quote=${quoteAddr})`,
        blockNumber: decoded.blockNumber,
        txHash: decoded.transactionHash,
        severity: 'warn',
      });
      return null;
    }

    const walletClass = this.p.runtime.walletClass(decoded.recipient);

    // Best-effort contract-wallet check (cached). No NormalizedTrade field exists
    // to carry it in round 1; live analytics refines wallet class from history.
    if (!this.p.runtime.isDemo) {
      try {
        const isContract = await this.p.runtime.codeChecker.isContract(decoded.recipient);
        if (isContract) {
          this.p.logger.debug(
            { trader: decoded.recipient },
            'indexer: trader has code (contract wallet) — flagged best-effort',
          );
        }
      } catch {
        /* code check is best-effort; ignore failures */
      }
    }

    return normalizeSwap(decoded, {
      pool,
      base,
      quote,
      pricing: this.p.runtime.pricing,
      blockTimestamp,
      ...(walletClass ? { walletClass } : {}),
      isDemo: this.p.runtime.isDemo,
    });
  }

  /**
   * Process a single block: decode its registered-pool swap logs and ingest each
   * normalized trade, then advance the checkpoint with the block hash. Returns
   * the number of trades ingested, or null when the block is not yet available.
   */
  async processBlock(blockNumber: bigint, head: bigint): Promise<number | null> {
    const block = await this.p.provider.getBlock(blockNumber);
    if (!block) return null;

    const poolAddresses = this.p.runtime.registry.poolAddresses();
    let ingested = 0;

    if (poolAddresses.length > 0) {
      const rawLogs = await this.p.provider.getLogs({
        fromBlock: blockNumber,
        toBlock: blockNumber,
        addresses: poolAddresses,
        topic0: SWAP_TOPIC0S,
      });
      const logs = dedupeLogs(ROBINHOOD_CHAIN_ID, rawLogs);
      const blockTimestamp = new Date(Number(block.timestamp) * 1000);
      const seenTradeIds = new Set<string>();

      for (const log of logs) {
        const decoded = this.p.runtime.registry.decode(log);
        if (!decoded) continue;
        let trade: NormalizedTrade | null = null;
        try {
          trade = await this.normalizeOne(decoded, blockTimestamp);
        } catch (err) {
          await this.p.errors.record({
            context: 'normalize',
            message: `failed to normalize log ${log.transactionHash}#${log.logIndex}: ${String(err)}`,
            blockNumber,
            txHash: log.transactionHash,
          });
          continue;
        }
        if (!trade) continue;
        if (seenTradeIds.has(trade.id)) continue; // batch-level dedupe
        seenTradeIds.add(trade.id);
        try {
          await this.p.pipeline.ingest(trade);
          ingested += 1;
          this.ingestedTotal += 1;
          this.lastTradeAtMs = trade.blockTimestamp.getTime();
        } catch (err) {
          await this.p.errors.record({
            context: 'ingest',
            message: `pipeline ingest failed for ${trade.id}: ${String(err)}`,
            blockNumber,
            txHash: trade.transactionHash,
          });
        }
      }
    }

    await this.p.checkpoint.advance({
      blockNumber,
      hash: block.hash,
      headBlock: head,
      confirmations: this.p.confirmations,
    });
    return ingested;
  }

  /**
   * Advance from the checkpoint tip up to `head − confirmations`, reconciling a
   * reorg first. Bounded by `maxBlocks` when provided (fast tests / demo runs).
   */
  async catchUp(opts: { maxBlocks?: number } = {}): Promise<CatchUpResult> {
    const head = await this.p.provider.getBlockNumber();
    const confirmed = head - BigInt(Math.max(0, this.p.confirmations));
    const target = confirmed > 0n ? confirmed : 0n;
    const reorgDeleted = await this.reconcile();
    await this.p.checkpoint.setHead(head, this.p.confirmations);

    let processedBlocks = 0;
    let ingestedTrades = 0;
    const limit = opts.maxBlocks ?? Number.POSITIVE_INFINITY;
    while (this.p.checkpoint.nextBlock() <= target && processedBlocks < limit) {
      const n = this.p.checkpoint.nextBlock();
      const ingested = await this.processBlock(n, head);
      if (ingested === null) break; // block not available yet
      processedBlocks += 1;
      ingestedTrades += ingested;
    }
    return { processedBlocks, ingestedTrades, head, target, reorgDeleted };
  }

  /** Publish an indexer_health envelope (lag, checkpoint, circuit state). */
  async publishHealth(): Promise<void> {
    const snap = this.p.checkpoint.snapshot();
    const status = this.p.provider.status();
    const head = snap.headBlock;
    const lag =
      head !== null ? (head - snap.lastIndexedBlock).toString() : null;
    await this.p.pubsub.publish('indexer_health', {
      mode: this.p.runtime.isDemo ? 'demo-indexer' : 'live',
      transport: status.transport,
      circuit: status.circuit,
      consecutiveFailures: status.consecutiveFailures,
      lastIndexedBlock: snap.lastIndexedBlock.toString(),
      lastFinalizedBlock: snap.lastFinalizedBlock.toString(),
      headBlock: head === null ? null : head.toString(),
      lag,
      tradesIngested: this.ingestedTotal,
      lastTradeAt: this.lastTradeAtMs,
      registeredPools: this.p.runtime.registry.size,
    });
  }

  /**
   * Live loop: subscribe to heads (WS with poll fallback), catch up on each new
   * head, and publish periodic health. Returns a stop function.
   */
  start(opts: { healthIntervalMs?: number } = {}): () => void {
    let running = true;
    const runCatchUp = (): void => {
      if (!running) return;
      if (this.catchingUp) {
        this.pending = true;
        return;
      }
      this.catchingUp = true;
      void this.catchUp()
        .catch((err) => this.p.logger.error({ err }, 'indexer: catchUp failed'))
        .finally(() => {
          this.catchingUp = false;
          if (this.pending && running) {
            this.pending = false;
            runCatchUp();
          }
        });
    };

    this.stopWatch = this.p.provider.watchHeads(
      () => runCatchUp(),
      (err) => this.p.logger.warn({ err }, 'indexer: head subscription error (falling back)'),
    );

    const healthMs = opts.healthIntervalMs ?? 10_000;
    const healthTimer = setInterval(() => {
      void this.publishHealth().catch((err) =>
        this.p.logger.error({ err }, 'indexer: health publish failed'),
      );
    }, healthMs);
    if (typeof healthTimer.unref === 'function') healthTimer.unref();

    return () => {
      running = false;
      if (this.stopWatch) this.stopWatch();
      clearInterval(healthTimer);
    };
  }
}
