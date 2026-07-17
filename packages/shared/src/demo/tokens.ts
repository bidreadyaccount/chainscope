import type { Hex } from '../types/common.js';
import type { Rng } from '../utils/prng.js';
import { demoAddress } from '../utils/hash.js';
import { PRICE_SOURCE_CONFIDENCE } from '@chainscope/config';
import type { DemoScenario, DemoToken } from './types.js';

/**
 * Demo quote assets. These are DEMO addresses (deterministic, clearly fake) used
 * only in demo mode — they do NOT claim to be real Robinhood Chain tokens.
 */
export const DEMO_ETH_USD = 3000;

export const DEMO_QUOTE_USDC = {
  symbol: 'USDC',
  address: demoAddress('quote', 'usdc') as Hex,
  decimals: 6,
} as const;

export const DEMO_QUOTE_WETH = {
  symbol: 'WETH',
  address: demoAddress('quote', 'weth') as Hex,
  decimals: 18,
} as const;

export const DEMO_DEX_NAME = 'RobinhoodSwap V2 (demo)';
export const DEMO_ROUTER = demoAddress('dex', 'router', 'v2') as Hex;

/** Scenario assignment across the 30 tokens (each named scenario represented). */
const SCENARIO_PLAN: DemoScenario[] = [
  ...Array<DemoScenario>(5).fill('WHALE_ACCUMULATION'),
  ...Array<DemoScenario>(4).fill('SMART_MONEY_BUYING'),
  ...Array<DemoScenario>(5).fill('RETAIL_MOMENTUM'),
  ...Array<DemoScenario>(3).fill('DEPLOYER_SELLING'),
  ...Array<DemoScenario>(3).fill('COORDINATED_NEW_WALLETS'),
  ...Array<DemoScenario>(3).fill('LIQUIDITY_REMOVAL'),
  ...Array<DemoScenario>(4).fill('MIXED_LOW_CONFIDENCE'),
  ...Array<DemoScenario>(3).fill('ORGANIC'),
];

// Deterministic symbol roots so tokens read like a real market list.
const SYMBOL_ROOTS = [
  'HOOD',
  'ORBIT',
  'NOVA',
  'PULSE',
  'QUARK',
  'ZEN',
  'FLUX',
  'AXON',
  'HELIX',
  'VOLT',
  'ATLAS',
  'CINDER',
  'DELTA',
  'EMBER',
  'FABLE',
  'GLYPH',
  'HYDRA',
  'IRIS',
  'JADE',
  'KRONOS',
  'LUMEN',
  'MYTH',
  'NEXUS',
  'ONYX',
  'PRISM',
  'QUILL',
  'RIFT',
  'SABLE',
  'TERRA',
  'UMBRA',
];

// Ensure 6, 8 and 18 decimals all appear; vary the rest.
const DECIMAL_CYCLE = [18, 18, 6, 8, 18, 9, 18, 6, 8, 18];

export function generateTokens(rng: Rng): DemoToken[] {
  const tokens: DemoToken[] = [];

  for (let i = 0; i < SCENARIO_PLAN.length; i++) {
    const scenario = SCENARIO_PLAN[i]!;
    const symbol = SYMBOL_ROOTS[i] ?? `TKN${i}`;
    const decimals = DECIMAL_CYCLE[i % DECIMAL_CYCLE.length]!;

    // One MIXED_LOW_CONFIDENCE token is deliberately unpriced.
    const isUnpriced = scenario === 'MIXED_LOW_CONFIDENCE' && i === firstMixedIndex();

    // Quote asset: alternate stable vs native to exercise both price paths.
    const useStable = i % 2 === 0;
    const quote = useStable ? DEMO_QUOTE_USDC : DEMO_QUOTE_WETH;

    const priceUsd = isUnpriced ? null : roundTo(rng.float(0.0004, 42), 6);
    const priceConfidence = isUnpriced
      ? PRICE_SOURCE_CONFIDENCE.UNKNOWN
      : useStable
        ? PRICE_SOURCE_CONFIDENCE.STABLE_POOL - rng.int(0, 8)
        : PRICE_SOURCE_CONFIDENCE.NATIVE_PAIR - rng.int(0, 12);

    const liquidityUsd =
      scenario === 'LIQUIDITY_REMOVAL'
        ? rng.float(8_000, 60_000)
        : scenario === 'MIXED_LOW_CONFIDENCE'
          ? rng.float(12_000, 120_000)
          : rng.float(60_000, 3_500_000);

    const liquidityChangePct =
      scenario === 'LIQUIDITY_REMOVAL'
        ? -rng.float(0.2, 0.6)
        : scenario === 'WHALE_ACCUMULATION' || scenario === 'SMART_MONEY_BUYING'
          ? rng.float(0.02, 0.25)
          : rng.float(-0.08, 0.12);

    const circulatingSupply = rng.float(1_000_000, 1_000_000_000);
    const ageDays = scenario === 'COORDINATED_NEW_WALLETS' ? rng.float(0.2, 6) : rng.float(3, 540);

    tokens.push({
      address: demoAddress('token', symbol, i),
      symbol,
      name: `${symbol} Token`,
      decimals,
      quoteSymbol: quote.symbol,
      quoteAddress: quote.address,
      quoteDecimals: quote.decimals,
      poolAddress: demoAddress('pool', symbol, quote.symbol, i),
      routerAddress: DEMO_ROUTER,
      dexName: DEMO_DEX_NAME,
      priceUsd,
      priceConfidence: Math.max(0, Math.round(priceConfidence)),
      liquidityUsd: roundTo(liquidityUsd, 2),
      liquidityChangePct: roundTo(liquidityChangePct, 4),
      circulatingSupply: Math.round(circulatingSupply),
      ageDays: roundTo(ageDays, 2),
      scenario,
    });
  }

  return tokens;
}

function firstMixedIndex(): number {
  return SCENARIO_PLAN.indexOf('MIXED_LOW_CONFIDENCE');
}

function roundTo(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
