/**
 * Adapter registry (SPEC §4). Built from configuration: a set of pool configs
 * (pool/router addresses, token0/token1 mapping, base/quote designation). A log
 * is matched by BOTH its emitting address (must be a registered pool) AND its
 * topic0 (must be the pool's adapter Swap event). When configuration is empty,
 * the registry is empty and live decoding is inactive — no addresses invented.
 */

import type { Hex } from '@chainscope/shared';
import type { ProviderLog } from '../provider/types.js';
import type { DexAdapter, DecodedSwap, DexKind, PoolConfig } from './types.js';
import { UniV2Adapter } from './univ2.js';
import { UniV3Adapter } from './univ3.js';
import { UniV4Adapter } from './univ4.js';

export interface RegistryEntry {
  readonly pool: PoolConfig;
  readonly adapter: DexAdapter;
}

export class AdapterRegistry {
  private readonly byPool = new Map<string, RegistryEntry>();
  private readonly adaptersByKind = new Map<DexKind, DexAdapter>();

  constructor(pools: readonly PoolConfig[] = []) {
    for (const pool of pools) this.addPool(pool);
  }

  private adapterFor(kind: DexKind, dexName: string): DexAdapter {
    const existing = this.adaptersByKind.get(kind);
    if (existing) return existing;
    const adapter: DexAdapter =
      kind === 'univ2'
        ? new UniV2Adapter(dexName)
        : kind === 'univ3'
          ? new UniV3Adapter(dexName)
          : new UniV4Adapter(dexName);
    this.adaptersByKind.set(kind, adapter);
    return adapter;
  }

  addPool(pool: PoolConfig): void {
    const adapter = this.adapterFor(pool.kind, pool.dexName);
    this.byPool.set(pool.poolAddress.toLowerCase(), { pool, adapter });
  }

  get size(): number {
    return this.byPool.size;
  }

  isEmpty(): boolean {
    return this.byPool.size === 0;
  }

  /** All registered pool addresses (lowercased) — used as the eth_getLogs filter. */
  poolAddresses(): Hex[] {
    return [...this.byPool.values()].map((e) => e.pool.poolAddress);
  }

  entryFor(address: Hex): RegistryEntry | undefined {
    return this.byPool.get(address.toLowerCase());
  }

  /**
   * Match + decode a single log. Returns null when the log is not from a
   * registered pool or its topic0 does not match that pool's adapter.
   */
  decode(log: ProviderLog): DecodedSwap | null {
    const entry = this.byPool.get(log.address.toLowerCase());
    if (!entry) return null;
    if (!entry.adapter.matches(log)) return null;
    return entry.adapter.decode(log, { pool: entry.pool });
  }
}
