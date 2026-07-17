/**
 * Historical backfill (SPEC §3). Pages `eth_getLogs` over the configured pools
 * in bounded block chunks and runs each log through the SAME processing path as
 * the live loop (decode → normalize → ingest). Idempotent: re-running any range
 * produces no duplicates thanks to the pipeline's (chainId, txHash, logIndex)
 * upsert, so a backfill can safely overlap already-indexed ranges.
 *
 * Backfill does NOT touch the live checkpoint or its reorg ring — it targets
 * historical (finalized) ranges. Timestamps are resolved per distinct block with
 * a small cache so a chunk with N logs across M blocks does at most M getBlock
 * calls.
 */

import { ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import type { NormalizedTrade } from '@chainscope/shared';
import type { Pipeline } from '@chainscope/api/pipeline/pipeline.js';
import type { ChainProvider } from './provider/types.js';
import { dedupeLogs } from './dedupe.js';
import { normalizeSwap, type TokenInfo } from './normalize.js';
import { SWAP_TOPIC0S } from './engine.js';
import type { RuntimeConfig } from './runtime-config.js';
import type { IndexerErrorRecorder, Logger } from './errors.js';

export interface BackfillDeps {
  readonly provider: ChainProvider;
  readonly runtime: RuntimeConfig;
  readonly pipeline: Pipeline;
  readonly errors: IndexerErrorRecorder;
  readonly logger: Logger;
}

export interface BackfillParams {
  readonly from: bigint;
  readonly to: bigint;
  /** Max blocks per getLogs page (default 2000). Bounded to keep responses sane. */
  readonly chunkSize?: number;
  /** Progress callback per completed chunk. */
  readonly onChunk?: (info: { from: bigint; to: bigint; ingested: number }) => void;
}

export interface BackfillResult {
  readonly chunks: number;
  readonly logs: number;
  readonly ingested: number;
  readonly from: bigint;
  readonly to: bigint;
}

/** Clamp the chunk size into a sane, bounded window. */
export function boundedChunkSize(requested: number | undefined): bigint {
  const n = requested && requested > 0 ? Math.floor(requested) : 2_000;
  return BigInt(Math.min(50_000, Math.max(1, n)));
}

export async function runBackfill(
  deps: BackfillDeps,
  params: BackfillParams,
): Promise<BackfillResult> {
  const { provider, runtime, pipeline, errors, logger } = deps;
  if (params.to < params.from) {
    throw new Error(`backfill: --to (${params.to}) must be >= --from (${params.from})`);
  }
  const poolAddresses = runtime.registry.poolAddresses();
  if (poolAddresses.length === 0) {
    logger.warn({}, 'backfill: no registered pools — nothing to do (configure pools first)');
    return { chunks: 0, logs: 0, ingested: 0, from: params.from, to: params.to };
  }

  const chunkSize = boundedChunkSize(params.chunkSize);
  let chunks = 0;
  let totalLogs = 0;
  let totalIngested = 0;

  for (let start = params.from; start <= params.to; start += chunkSize) {
    let end = start + chunkSize - 1n;
    if (end > params.to) end = params.to;

    let rawLogs;
    try {
      rawLogs = await provider.getLogs({
        fromBlock: start,
        toBlock: end,
        addresses: poolAddresses,
        topic0: SWAP_TOPIC0S,
      });
    } catch (err) {
      await errors.record({
        context: 'backfill.getLogs',
        message: `getLogs failed for [${start}, ${end}]: ${String(err)}`,
        blockNumber: start,
      });
      chunks += 1;
      continue;
    }

    const logs = dedupeLogs(ROBINHOOD_CHAIN_ID, rawLogs);
    totalLogs += logs.length;
    const tsCache = new Map<string, Date>();
    let chunkIngested = 0;

    for (const log of logs) {
      const decoded = runtime.registry.decode(log);
      if (!decoded) continue;

      const entry = runtime.registry.entryFor(decoded.poolAddress);
      if (!entry) continue;
      const pool = entry.pool;
      const baseAddr = pool.baseIsToken0 ? pool.token0Address : pool.token1Address;
      const quoteAddr = pool.baseIsToken0 ? pool.token1Address : pool.token0Address;
      const [base, quote] = await Promise.all([
        runtime.metaResolver.resolve(baseAddr),
        runtime.metaResolver.resolve(quoteAddr),
      ]);
      if (!base || !quote) continue;

      const blockTimestamp = await resolveBlockTs(provider, log.blockNumber, tsCache);
      const walletClass = runtime.walletClass(decoded.recipient);
      const info: TokenInfo = base;
      let trade: NormalizedTrade | null;
      try {
        trade = normalizeSwap(decoded, {
          pool,
          base: info,
          quote,
          pricing: runtime.pricing,
          blockTimestamp,
          ...(walletClass ? { walletClass } : {}),
          isDemo: runtime.isDemo,
        });
      } catch (err) {
        await errors.record({
          context: 'backfill.normalize',
          message: `normalize failed for ${log.transactionHash}#${log.logIndex}: ${String(err)}`,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
        });
        continue;
      }
      if (!trade) continue;

      try {
        await pipeline.ingest(trade);
        chunkIngested += 1;
      } catch (err) {
        await errors.record({
          context: 'backfill.ingest',
          message: `ingest failed for ${trade.id}: ${String(err)}`,
          blockNumber: log.blockNumber,
          txHash: trade.transactionHash,
        });
      }
    }

    totalIngested += chunkIngested;
    chunks += 1;
    params.onChunk?.({ from: start, to: end, ingested: chunkIngested });
    logger.info(
      { from: start.toString(), to: end.toString(), logs: logs.length, ingested: chunkIngested },
      'backfill: chunk complete',
    );
  }

  return { chunks, logs: totalLogs, ingested: totalIngested, from: params.from, to: params.to };
}

async function resolveBlockTs(
  provider: ChainProvider,
  blockNumber: bigint,
  cache: Map<string, Date>,
): Promise<Date> {
  const key = blockNumber.toString();
  const cached = cache.get(key);
  if (cached) return cached;
  const block = await provider.getBlock(blockNumber);
  const ts = block ? new Date(Number(block.timestamp) * 1000) : new Date();
  cache.set(key, ts);
  return ts;
}
