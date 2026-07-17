import type { NormalizedTrade } from '../types/trade.js';
import { mulberry32, DEFAULT_SEED } from '../utils/prng.js';
import { generateTokens } from './tokens.js';
import { generateWallets } from './wallets.js';
import {
  buildPools,
  pickForScenario,
  valueForClass,
  buildTrade,
  type WalletPools,
} from './generator.js';
import type { DemoToken } from './types.js';

export interface DemoTradeStream {
  /**
   * Produce the next deterministic trade. `at` is the wall-clock time to stamp
   * the trade with (defaults to now). Sequence content (token, wallet, side,
   * amounts, hash) is fully determined by the seed and call order.
   */
  next(at?: Date): NormalizedTrade;
  /** Start emitting on `intervalMs`; returns a stop function. */
  start(onTrade: (trade: NormalizedTrade) => void): () => void;
  readonly seed: number;
  readonly intervalMs: number;
}

// Stream sequence numbers start well above the historical range so demo-stream
// tx hashes/ids never collide with the seeded historical dataset.
const STREAM_SEQ_BASE = 10_000_000;

/**
 * Factory for a deterministic live-trade stream (BUILD_BRIEF §7 — the live demo
 * stream is the same generator emitting new trades on an interval). Pure aside
 * from the wall clock used to timestamp each emitted trade.
 */
export function createDemoTradeStream(
  seed: number = DEFAULT_SEED,
  intervalMs = 2_500,
): DemoTradeStream {
  // Derive an independent RNG so stream draws don't depend on dataset draws.
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const tokens = generateTokens(mulberry32(seed));
  const population = generateWallets(mulberry32(seed));
  const pools: WalletPools = buildPools(population);

  // Weight token selection toward the more active scenarios.
  const weightFor = (t: DemoToken): number => {
    switch (t.scenario) {
      case 'RETAIL_MOMENTUM':
        return 4;
      case 'ORGANIC':
      case 'COORDINATED_NEW_WALLETS':
        return 3;
      case 'WHALE_ACCUMULATION':
      case 'SMART_MONEY_BUYING':
        return 2;
      default:
        return 1;
    }
  };
  const weights = tokens.map(weightFor);

  let seq = STREAM_SEQ_BASE;

  const next = (at: Date = new Date()): NormalizedTrade => {
    const token = rng.weighted(tokens, weights);
    const { wallet, side } = pickForScenario(rng, token.scenario, pools);
    const valueUsd = valueForClass(rng, wallet.primaryClass);
    // offsetMs 0 => stamped exactly at `at`.
    const trade = buildTrade(token, wallet, side, valueUsd, 0, at.getTime(), seed, seq);
    seq++;
    return trade;
  };

  const start = (onTrade: (trade: NormalizedTrade) => void): (() => void) => {
    const timer = setInterval(() => onTrade(next()), intervalMs);
    // Do not keep the event loop alive solely for the demo stream.
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  };

  return { next, start, seed, intervalMs };
}
