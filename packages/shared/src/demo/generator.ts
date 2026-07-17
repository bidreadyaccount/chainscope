import type { NormalizedTrade, TradeSide } from '../types/trade.js';
import { CHAIN_ID } from '../types/common.js';
import type { WalletClass } from '../types/wallet.js';
import { mulberry32, DEFAULT_SEED, type Rng } from '../utils/prng.js';
import { demoTxHash, demoId } from '../utils/hash.js';
import { toRawAmount } from '../utils/amount.js';
import { generateTokens, DEMO_ETH_USD } from './tokens.js';
import { generateWallets, type DemoWalletPopulation } from './wallets.js';
import {
  DEMO_SCENARIOS,
  type DemoScenario,
  type DemoDataset,
  type DemoToken,
  type DemoWallet,
} from './types.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const BASE_BLOCK = 5_000_000n;
const BLOCK_TIME_MS = 2_000;

/** Historical trade counts per token, by scenario. Sum > 5000 with bot bursts. */
const TRADE_COUNTS: Record<DemoScenario, number> = {
  WHALE_ACCUMULATION: 130,
  SMART_MONEY_BUYING: 140,
  RETAIL_MOMENTUM: 270,
  DEPLOYER_SELLING: 130,
  COORDINATED_NEW_WALLETS: 210,
  LIQUIDITY_REMOVAL: 130,
  MIXED_LOW_CONFIDENCE: 160,
  ORGANIC: 230,
};

export interface WalletPools {
  megaWhales: DemoWallet[];
  whales: DemoWallet[];
  smart: DemoWallet[];
  large: DemoWallet[];
  retail: DemoWallet[];
  newWallets: DemoWallet[];
  bots: DemoWallet[];
  deployers: DemoWallet[];
  deployerLinked: DemoWallet[];
  marketMaker: DemoWallet;
  all: DemoWallet[];
}

export function buildPools(pop: DemoWalletPopulation): WalletPools {
  const by = (a: DemoWallet['archetype']) => pop.wallets.filter((w) => w.archetype === a);
  return {
    megaWhales: by('MEGA_WHALE'),
    whales: by('WHALE'),
    smart: by('SMART_MONEY'),
    large: by('LARGE_TRADER'),
    retail: by('RETAIL'),
    newWallets: by('NEW_WALLET'),
    bots: by('BOT'),
    deployers: by('DEPLOYER'),
    deployerLinked: by('DEPLOYER_LINKED'),
    marketMaker: pop.marketMaker,
    all: pop.wallets,
  };
}

export function valueForClass(rng: Rng, cls: WalletClass): number {
  switch (cls) {
    case 'MEGA_WHALE':
      return rng.float(40_000, 300_000);
    case 'WHALE':
      return rng.float(25_000, 120_000);
    case 'SMART_MONEY':
      return rng.float(4_000, 45_000);
    case 'LARGE_TRADER':
      return rng.float(3_000, 15_000);
    case 'RETAIL':
      return rng.float(100, 1_500);
    case 'NEW_WALLET':
      return rng.float(150, 2_500);
    case 'DEPLOYER_LINKED':
      return rng.float(5_000, 60_000);
    case 'MARKET_MAKER':
      return rng.float(8_000, 40_000);
    default:
      return rng.float(500, 5_000);
  }
}

export interface Pick {
  wallet: DemoWallet;
  side: TradeSide;
}

export function pickForScenario(rng: Rng, scenario: DemoScenario, pools: WalletPools): Pick {
  const buyBias = (p: number): TradeSide => (rng.bool(p) ? 'BUY' : 'SELL');

  switch (scenario) {
    case 'WHALE_ACCUMULATION': {
      if (rng.bool(0.7)) {
        const wallet = rng.pick([...pools.megaWhales, ...pools.whales]);
        return { wallet, side: buyBias(0.85) };
      }
      return { wallet: rng.pick([...pools.retail, ...pools.large]), side: buyBias(0.5) };
    }
    case 'SMART_MONEY_BUYING': {
      if (rng.bool(0.65)) return { wallet: rng.pick(pools.smart), side: buyBias(0.85) };
      if (rng.bool(0.5)) return { wallet: rng.pick(pools.whales), side: buyBias(0.7) };
      return { wallet: rng.pick(pools.retail), side: buyBias(0.45) };
    }
    case 'RETAIL_MOMENTUM': {
      if (rng.bool(0.82)) return { wallet: rng.pick(pools.retail), side: buyBias(0.72) };
      return { wallet: rng.pick([...pools.newWallets, ...pools.large]), side: buyBias(0.6) };
    }
    case 'DEPLOYER_SELLING': {
      if (rng.bool(0.6)) {
        const wallet = rng.pick([...pools.deployers, ...pools.deployerLinked]);
        return { wallet, side: buyBias(0.12) }; // mostly selling
      }
      return { wallet: rng.pick(pools.retail), side: buyBias(0.55) };
    }
    case 'COORDINATED_NEW_WALLETS': {
      if (rng.bool(0.78)) return { wallet: rng.pick(pools.newWallets), side: buyBias(0.9) };
      return { wallet: rng.pick(pools.retail), side: buyBias(0.6) };
    }
    case 'LIQUIDITY_REMOVAL': {
      if (rng.bool(0.2)) return { wallet: pools.marketMaker, side: buyBias(0.3) };
      return { wallet: rng.pick(pools.all), side: buyBias(0.3) }; // net selling
    }
    case 'MIXED_LOW_CONFIDENCE': {
      return { wallet: rng.pick(pools.all), side: buyBias(0.5) };
    }
    case 'ORGANIC':
    default: {
      const wallet = rng.pick([
        ...pools.retail,
        ...pools.large,
        ...pools.smart,
        ...pools.whales,
        ...pools.newWallets,
      ]);
      return { wallet, side: buyBias(0.52) };
    }
  }
}

export function buildTrade(
  token: DemoToken,
  wallet: DemoWallet,
  side: TradeSide,
  valueUsd: number,
  offsetMs: number,
  now: number,
  seed: number,
  seq: number,
): NormalizedTrade {
  const blockTimestamp = new Date(now - offsetMs);
  const blockNumber =
    BASE_BLOCK + BigInt(Math.max(0, Math.floor((WINDOW_MS - offsetMs) / BLOCK_TIME_MS)));

  const priced = token.priceUsd !== null && token.priceUsd > 0;

  let tokenAmountHuman: number;
  let quoteAmountHuman: number;
  let priceUsd: number | null;
  let tradeValueUsd: number | null;

  if (priced) {
    priceUsd = token.priceUsd;
    tradeValueUsd = valueUsd;
    tokenAmountHuman = valueUsd / (token.priceUsd as number);
    quoteAmountHuman = token.quoteSymbol === 'USDC' ? valueUsd : valueUsd / DEMO_ETH_USD;
  } else {
    // Deliberately unpriced token → exercise "insufficient pricing data".
    priceUsd = null;
    tradeValueUsd = null;
    tokenAmountHuman = valueUsd; // treat chosen magnitude as raw token qty
    quoteAmountHuman = valueUsd / DEMO_ETH_USD;
  }

  return {
    id: demoId('trade', seed, token.symbol, seq),
    chainId: CHAIN_ID,
    transactionHash: demoTxHash(seed, token.symbol, seq),
    logIndex: seq % 8,
    blockNumber,
    blockTimestamp,
    dexName: token.dexName,
    routerAddress: token.routerAddress,
    poolAddress: token.poolAddress,
    traderAddress: wallet.address,
    tokenAddress: token.address,
    tokenSymbol: token.symbol,
    quoteTokenAddress: token.quoteAddress,
    quoteTokenSymbol: token.quoteSymbol,
    side,
    tokenAmount: toRawAmount(tokenAmountHuman, token.decimals),
    quoteAmount: toRawAmount(quoteAmountHuman, token.quoteDecimals),
    priceUsd,
    valueUsd: tradeValueUsd === null ? null : round2(tradeValueUsd),
    priceConfidence: token.priceConfidence,
    walletClass: wallet.primaryClass,
    walletClassificationConfidence: wallet.classificationConfidence,
    isDemo: true,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Generate the full deterministic demo dataset. Same `seed` + `now` always
 * yields identical output. `now` defaults to a fixed anchor so the default call
 * is fully reproducible; the API/streaming layer passes the real clock.
 */
export function generateDemoDataset(
  seed: number = DEFAULT_SEED,
  now: number = Date.UTC(2025, 0, 1, 0, 0, 0),
): DemoDataset {
  const rng = mulberry32(seed);
  const tokens = generateTokens(rng);
  const population = generateWallets(rng);
  const pools = buildPools(population);

  const trades: NormalizedTrade[] = [];
  const scenarioCounts = Object.fromEntries(DEMO_SCENARIOS.map((s) => [s, 0])) as Record<
    DemoScenario,
    number
  >;

  let seq = 0;

  for (const token of tokens) {
    const count = TRADE_COUNTS[token.scenario];
    // Per-token coordinated size for the coordinated-wallet scenario.
    const coordinatedSize = rng.float(400, 1_200);

    for (let i = 0; i < count; i++) {
      const { wallet, side } = pickForScenario(rng, token.scenario, pools);

      let valueUsd: number;
      let offsetMs: number;

      if (token.scenario === 'COORDINATED_NEW_WALLETS' && wallet.archetype === 'NEW_WALLET') {
        // Near-identical sizes in a tight, recent window => coordinated look.
        valueUsd = coordinatedSize * rng.float(0.97, 1.03);
        offsetMs = rng.float(15 * 60_000, 110 * 60_000);
      } else {
        valueUsd = valueForClass(rng, wallet.primaryClass);
        offsetMs = rng.float(0, WINDOW_MS);
      }

      trades.push(buildTrade(token, wallet, side, valueUsd, offsetMs, now, seed, seq));
      scenarioCounts[token.scenario]++;
      seq++;
    }
  }

  // Bot bursts: rapid, identical-size trades from each bot on a chosen token.
  const botTargets = tokens.filter(
    (t) => t.scenario === 'ORGANIC' || t.scenario === 'MIXED_LOW_CONFIDENCE',
  );
  for (const bot of pools.bots) {
    const token = rng.pick(botTargets.length > 0 ? botTargets : tokens);
    const burstSize = rng.int(20, 40);
    const identicalValue = valueForClass(rng, 'SMART_MONEY'); // fixed per bot
    const side: TradeSide = rng.bool(0.5) ? 'BUY' : 'SELL';
    const burstStartOffset = rng.float(10 * 60_000, WINDOW_MS - 10 * 60_000);
    for (let b = 0; b < burstSize; b++) {
      // ~4s apart => abnormally high frequency + identical amounts.
      const offsetMs = Math.max(0, burstStartOffset - b * 4_000);
      trades.push(buildTrade(token, bot, side, identicalValue, offsetMs, now, seed, seq));
      scenarioCounts[token.scenario]++;
      seq++;
    }
  }

  // Sort newest-first for convenient consumption; deterministic tiebreak on id.
  trades.sort((a, b) => {
    const t = b.blockTimestamp.getTime() - a.blockTimestamp.getTime();
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });

  return { seed, now, tokens, wallets: population.wallets, trades, scenarioCounts };
}
