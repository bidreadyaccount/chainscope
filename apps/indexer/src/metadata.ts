/**
 * Token metadata resolution + contract-wallet detection (SPEC §5).
 *
 * - `TokenMetadataResolver` resolves symbol/decimals for a token address. In
 *   demo mode this comes from the generator; in live mode a multicall-backed
 *   fetcher (injected) reads `symbol()`/`decimals()` and the result is cached in
 *   the `Token` table so repeat lookups are free.
 * - `CodeChecker` flags whether a trader address has bytecode (a contract
 *   wallet / router). Cached and best-effort — the fetcher is injected so live
 *   mode uses `eth_getCode` and demo mode returns EOA for everyone.
 *
 * Both fetchers are injected (not hard-wired to viem) so the logic is unit
 * testable without any network.
 */

import type { PrismaClient } from '@chainscope/database';
import { ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import type { Hex } from '@chainscope/shared';
import type { TokenInfo } from './normalize.js';

export interface TokenMetadataResolver {
  resolve(address: Hex): Promise<TokenInfo | undefined>;
}

/** Demo resolver — metadata from a fixed address→info map. */
export class StaticTokenMetadataResolver implements TokenMetadataResolver {
  private readonly byAddress = new Map<string, TokenInfo>();
  constructor(infos: readonly TokenInfo[]) {
    for (const i of infos) this.byAddress.set(i.address.toLowerCase(), i);
  }
  resolve(address: Hex): Promise<TokenInfo | undefined> {
    return Promise.resolve(this.byAddress.get(address.toLowerCase()));
  }
}

export type OnchainMetaFetcher = (
  address: Hex,
) => Promise<{ symbol: string; decimals: number } | undefined>;

/**
 * Live resolver: in-memory cache → Token table → onchain fetch (then persisted).
 * The onchain fetcher is injected (viem multicall in production).
 */
export class LiveTokenMetadataResolver implements TokenMetadataResolver {
  private readonly cache = new Map<string, TokenInfo>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly fetchOnchain: OnchainMetaFetcher,
  ) {}

  async resolve(address: Hex): Promise<TokenInfo | undefined> {
    const key = address.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const row = await this.prisma.token.findUnique({
      where: { chainId_address: { chainId: ROBINHOOD_CHAIN_ID, address } },
      select: { symbol: true, decimals: true },
    });
    if (row) {
      const info: TokenInfo = { address, symbol: row.symbol, decimals: row.decimals };
      this.cache.set(key, info);
      return info;
    }

    const meta = await this.fetchOnchain(address);
    if (!meta) return undefined;
    const info: TokenInfo = { address, symbol: meta.symbol, decimals: meta.decimals };
    await this.prisma.token.upsert({
      where: { chainId_address: { chainId: ROBINHOOD_CHAIN_ID, address } },
      create: {
        chainId: ROBINHOOD_CHAIN_ID,
        address,
        symbol: meta.symbol,
        name: meta.symbol,
        decimals: meta.decimals,
        isDemo: false,
      },
      update: {},
    });
    this.cache.set(key, info);
    return info;
  }
}

export type CodeFetcher = (address: Hex) => Promise<Hex | undefined>;

/** Cached contract-wallet detector. */
export class CodeChecker {
  private readonly cache = new Map<string, boolean>();
  private fetches = 0;

  constructor(private readonly getCode: CodeFetcher) {}

  async isContract(address: Hex): Promise<boolean> {
    const key = address.toLowerCase();
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    this.fetches += 1;
    const code = await this.getCode(address);
    const isContract = code !== undefined && code !== '0x' && code.length > 2;
    this.cache.set(key, isContract);
    return isContract;
  }

  /** Number of underlying fetches performed (cache-miss count) — for tests. */
  get fetchCount(): number {
    return this.fetches;
  }
}

/** Always-EOA checker used in demo mode. */
export const demoCodeChecker = new CodeChecker(() => Promise.resolve('0x'));
