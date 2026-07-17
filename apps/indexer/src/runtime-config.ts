/**
 * Runtime configuration assembly (SPEC §4). Builds the adapter registry,
 * pricing config, token-metadata resolver and wallet-class resolver the engine
 * needs — from the demo fixtures (demo mode) or from env + the DB (live mode).
 *
 * LIVE MODE: pool configuration (pool address, token0/token1, quote-token
 * designation, DEX protocol) is read from the `LiquidityPool` + `Dex` tables,
 * which operators populate with VERIFIED Robinhood Chain addresses. NOTHING is
 * invented. When no pools are configured the registry is empty and the engine
 * logs that live decoding is inactive.
 */

import type { Env } from '@chainscope/config';
import { parseStablecoins, ROBINHOOD_CHAIN_ID } from '@chainscope/config';
import type { PrismaClient } from '@chainscope/database';
import type { Hex, WalletClass } from '@chainscope/shared';
import { AdapterRegistry } from './adapters/registry.js';
import type { DexKind, PoolConfig } from './adapters/types.js';
import type { PricingConfig } from './pricing.js';
import {
  StaticTokenMetadataResolver,
  LiveTokenMetadataResolver,
  CodeChecker,
  demoCodeChecker,
  type TokenMetadataResolver,
} from './metadata.js';
import type { WalletClassResolution } from './normalize.js';
import {
  demoPoolConfigs,
  demoTokenInfos,
  demoPricingConfig,
  demoWalletClassMap,
} from './demo-fixtures.js';

export interface RuntimeConfig {
  readonly registry: AdapterRegistry;
  readonly pricing: PricingConfig;
  readonly metaResolver: TokenMetadataResolver;
  readonly codeChecker: CodeChecker;
  /** Resolve a trader's wallet class (demo map / live classifier). */
  readonly walletClass: (address: Hex) => WalletClassResolution | undefined;
  readonly isDemo: boolean;
  /** Checkpoint stream name for this configuration. */
  readonly stream: string;
}

/** Demo runtime: everything derived deterministically from the seed. */
export function buildDemoRuntime(seed: number): RuntimeConfig {
  const classMap = demoWalletClassMap(seed);
  return {
    registry: new AdapterRegistry(demoPoolConfigs(seed)),
    pricing: demoPricingConfig(),
    metaResolver: new StaticTokenMetadataResolver(demoTokenInfos(seed)),
    codeChecker: demoCodeChecker,
    walletClass: (address) => classMap.get(address.toLowerCase()),
    isDemo: true,
    stream: 'demo',
  };
}

/** Map a `Dex.protocol` string to an adapter kind, or null if unsupported. */
export function protocolToKind(protocol: string): DexKind | null {
  switch (protocol) {
    case 'UNISWAP_V2':
      return 'univ2';
    case 'UNISWAP_V3':
      return 'univ3';
    case 'UNISWAP_V4':
      return 'univ4';
    default:
      return null;
  }
}

/**
 * Load pool configs from the DB (`LiquidityPool` joined with `Dex`). Only
 * non-demo, enabled pools with a supported protocol are returned. `baseIsToken0`
 * is derived by comparing the quote-token address to token0.
 */
export async function loadLivePoolConfigs(prisma: PrismaClient): Promise<PoolConfig[]> {
  const rows = await prisma.liquidityPool.findMany({
    where: { chainId: ROBINHOOD_CHAIN_ID, isDemo: false, dex: { enabled: true } },
    include: { dex: true },
  });
  const out: PoolConfig[] = [];
  for (const row of rows) {
    const kind = protocolToKind(row.dex.protocol);
    if (!kind || kind === 'univ4') continue; // V4 decoding is not implemented (round 2)
    const quoteIsToken0 =
      row.quoteTokenAddress.toLowerCase() === row.token0Address.toLowerCase();
    out.push({
      poolAddress: row.address as Hex,
      kind,
      dexName: row.dex.name,
      ...(row.dex.routerAddress ? { routerAddress: row.dex.routerAddress as Hex } : {}),
      token0Address: row.token0Address as Hex,
      token1Address: row.token1Address as Hex,
      // base is the non-quote side.
      baseIsToken0: !quoteIsToken0,
    });
  }
  return out;
}

/**
 * Live runtime built from env + DB. `ethUsdReferenceUsd` is null unless a
 * trusted reference is supplied (tier-2 pricing stays inactive until then — see
 * PHASE_4.md). The onchain metadata fetcher is injected; when absent (MVP with
 * no verified addresses) unknown tokens simply resolve to undefined and their
 * swaps are skipped rather than fabricated.
 */
export async function buildLiveRuntime(
  prisma: PrismaClient,
  env: Env,
  opts: {
    ethUsdReferenceUsd?: number | null;
    onchainMeta?: (address: Hex) => Promise<{ symbol: string; decimals: number } | undefined>;
    getCode?: (address: Hex) => Promise<Hex | undefined>;
  } = {},
): Promise<RuntimeConfig> {
  const pools = await loadLivePoolConfigs(prisma);
  const stablecoins = new Set(parseStablecoins(env));
  const pricing: PricingConfig = {
    stablecoins,
    ...(env.ROBINHOOD_WRAPPED_NATIVE
      ? { wrappedNative: env.ROBINHOOD_WRAPPED_NATIVE as Hex }
      : {}),
    ethUsdReferenceUsd: opts.ethUsdReferenceUsd ?? null,
  };
  const metaResolver = new LiveTokenMetadataResolver(
    prisma,
    opts.onchainMeta ?? (() => Promise.resolve(undefined)),
  );
  const codeChecker = new CodeChecker(opts.getCode ?? (() => Promise.resolve('0x')));

  // Live wallet classification from history is a pipeline concern; the decoder
  // ingests with UNKNOWN and the analytics layer refines it. Documented in PHASE_4.
  const walletClass = (_address: Hex): WalletClassResolution | undefined => undefined;

  return {
    registry: new AdapterRegistry(pools),
    pricing,
    metaResolver,
    codeChecker,
    walletClass,
    isDemo: false,
    stream: 'live',
  };
}

export type { WalletClass };
