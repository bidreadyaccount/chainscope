/**
 * Token metadata provider (price, liquidity, liquidity-change, contract
 * verification, baseline volume) needed by the analytics engines and by REST
 * display.
 *
 * In DEMO mode this is sourced deterministically from the same generator that
 * produced the seeded dataset, so price/liquidity/liquidity-removal scenarios
 * and the deliberately-unpriced token stay faithful (the DB does not persist
 * price or liquidity-change). In LIVE mode (Phase 4) this will be sourced from
 * the price/liquidity engine writing Token/LiquidityPool rows.
 */

import { generateTokens, mulberry32, type DemoToken } from '@chainscope/shared';
import type { TokenMeta } from './analytics.js';

export interface TokenMetaProvider {
  meta(address: string): TokenMeta | undefined;
  token(address: string): DemoToken | undefined;
  addresses(): string[];
}

export function createDemoTokenMetaProvider(seed: number): TokenMetaProvider {
  const tokens = generateTokens(mulberry32(seed));
  const byAddress = new Map<string, DemoToken>();
  for (const t of tokens) byAddress.set(t.address.toLowerCase(), t);

  const toMeta = (t: DemoToken): TokenMeta => ({
    priceUsd: t.priceUsd,
    priceConfidence: t.priceConfidence,
    liquidityUsd: t.liquidityUsd,
    liquidityChangePct: t.liquidityChangePct,
    // Seed marks MIXED_LOW_CONFIDENCE tokens unverified (see packages/database seed).
    contractVerified: t.scenario !== 'MIXED_LOW_CONFIDENCE',
  });

  return {
    meta(address) {
      const t = byAddress.get(address.toLowerCase());
      return t ? toMeta(t) : undefined;
    },
    token(address) {
      return byAddress.get(address.toLowerCase());
    },
    addresses() {
      return tokens.map((t) => t.address);
    },
  };
}
