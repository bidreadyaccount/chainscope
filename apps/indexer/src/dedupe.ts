/**
 * Duplicate-log protection (SPEC §5). The same event can be delivered more than
 * once — overlapping getLogs ranges, WS + poll double-delivery, or a retried
 * request. Events are uniquely keyed on (chainId, txHash, logIndex); this
 * de-duplicates a batch on that key BEFORE ingest so a token's metrics never
 * double-count. The pipeline's `(chainId, txHash, logIndex)` upsert is a second,
 * persistence-level guard, so re-running any range is idempotent regardless.
 */

import type { ProviderLog } from './provider/types.js';

/** Unique key for an event log. */
export function logKey(chainId: number, txHash: string, logIndex: number): string {
  return `${chainId}:${txHash.toLowerCase()}:${logIndex}`;
}

/**
 * Return the input logs with duplicates (same tx hash + logIndex) removed,
 * keeping the first occurrence and preserving order. Logs flagged `removed`
 * (reorg tombstones on a subscription) are dropped entirely.
 */
export function dedupeLogs(chainId: number, logs: readonly ProviderLog[]): ProviderLog[] {
  const seen = new Set<string>();
  const out: ProviderLog[] = [];
  for (const log of logs) {
    if (log.removed) continue;
    const key = logKey(chainId, log.transactionHash, log.logIndex);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(log);
  }
  return out;
}
