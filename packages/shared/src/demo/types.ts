import type { Hex } from '../types/common.js';
import type { NormalizedTrade } from '../types/trade.js';
import type { WalletClass } from '../types/wallet.js';

/** Named demo scenarios (SPEC §18). */
export const DEMO_SCENARIOS = [
  'WHALE_ACCUMULATION',
  'SMART_MONEY_BUYING',
  'RETAIL_MOMENTUM',
  'DEPLOYER_SELLING',
  'COORDINATED_NEW_WALLETS',
  'LIQUIDITY_REMOVAL',
  'MIXED_LOW_CONFIDENCE',
  'ORGANIC',
] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

/** Wallet archetypes seeded into the demo population. */
export const DEMO_ARCHETYPES = [
  'MEGA_WHALE',
  'WHALE',
  'SMART_MONEY',
  'LARGE_TRADER',
  'RETAIL',
  'NEW_WALLET',
  'BOT',
  'DEPLOYER',
  'DEPLOYER_LINKED',
  'MARKET_MAKER',
] as const;
export type DemoArchetype = (typeof DEMO_ARCHETYPES)[number];

export interface DemoToken {
  address: Hex;
  symbol: string;
  name: string;
  decimals: number;
  quoteSymbol: string;
  quoteAddress: Hex;
  quoteDecimals: number;
  poolAddress: Hex;
  routerAddress: Hex;
  dexName: string;
  /** USD price, or null for the deliberately unpriced token. */
  priceUsd: number | null;
  priceConfidence: number;
  liquidityUsd: number;
  /** Signed 24h liquidity change fraction (negative => removal). */
  liquidityChangePct: number;
  circulatingSupply: number;
  ageDays: number;
  scenario: DemoScenario;
}

export interface DemoWallet {
  address: Hex;
  archetype: DemoArchetype;
  primaryClass: WalletClass;
  classificationConfidence: number;
  portfolioUsd: number;
  /** Shared funding source for clusters / bot fleets. */
  fundingSourceAddress?: Hex;
  firstSeenDaysAgo: number;
  lifetimeTxs: number;
  isProfitable: boolean;
}

export interface DemoDataset {
  seed: number;
  now: number;
  tokens: DemoToken[];
  wallets: DemoWallet[];
  trades: NormalizedTrade[];
  scenarioCounts: Record<DemoScenario, number>;
}
