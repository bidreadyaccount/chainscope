/**
 * Index valuation: basket construction, level (NAV/divisor), performance,
 * sector allocation, concentration and rebalance turnover.
 *
 * Level methodology (documented for audit): the index holds notional `shares`
 * of each constituent. At inception, shares are chosen so the basket's USD value
 * equals `baseValue` while realizing the target weights, and the divisor is set
 * to 1, so level = NAV = baseValue. Thereafter level = NAV / divisor where
 * NAV = Σ shares_i · price_i. A rebalance reallocates the SAME NAV across new
 * weights (shares recomputed), so NAV — and therefore level — is continuous; the
 * divisor is unchanged by a pure rebalance. (The divisor is retained so future
 * capital events can preserve continuity by adjusting it.)
 */

import { WEIGHT_DENOMINATOR_BPS, TRADING_DAYS_PER_YEAR } from '@chainscope/config';
import { round } from '../math.js';
import type {
  Basket,
  ConcentrationResult,
  ConstituentInput,
  ConstituentWeight,
  LevelResult,
  PerformancePoint,
  PerformanceResult,
  SectorAllocation,
} from './types.js';

const BPS = WEIGHT_DENOMINATOR_BPS;

/**
 * Build the notional basket that realizes `weights` at the given constituent
 * prices, scaled so NAV = baseValue and level = baseValue (divisor = 1).
 * Constituents without a positive price are dropped from the basket (they carry
 * no shares); their weight is treated as uninvested — callers should ensure
 * priced constituents were used to build the weights.
 */
export function buildBasket(
  weights: readonly ConstituentWeight[],
  prices: ReadonlyMap<string, number | null>,
  baseValue: number,
): Basket {
  const holdings = weights.map((w) => {
    const price = prices.get(w.stockTokenId) ?? null;
    const targetUsd = (w.weightBps / BPS) * baseValue;
    const shares = price !== null && price > 0 ? targetUsd / price : 0;
    return { stockTokenId: w.stockTokenId, ticker: w.ticker, shares, weightBps: w.weightBps };
  });
  const navUsd = holdings.reduce((s, h) => {
    const price = prices.get(h.stockTokenId) ?? 0;
    return s + h.shares * (price ?? 0);
  }, 0);
  const divisor = 1;
  return { holdings, divisor, navUsd: round(navUsd, 2), level: round(navUsd / divisor, 4) };
}

/** Recompute level for an existing basket at new prices. */
export function computeLevel(
  basket: Basket,
  prices: ReadonlyMap<string, number | null>,
): LevelResult {
  const navUsd = basket.holdings.reduce((s, h) => {
    const price = prices.get(h.stockTokenId) ?? 0;
    return s + h.shares * (price ?? 0);
  }, 0);
  return { navUsd: round(navUsd, 2), level: round(navUsd / basket.divisor, 4) };
}

/**
 * Sector allocation: sum constituent weights by sector. Weights that reference a
 * constituent not present in `constituents` are bucketed as 'Unknown'.
 */
export function computeSectorAllocation(
  weights: readonly ConstituentWeight[],
  constituents: readonly ConstituentInput[],
): SectorAllocation[] {
  const sectorOf = new Map(constituents.map((c) => [c.stockTokenId, c.sector]));
  const bySector = new Map<string, number>();
  for (const w of weights) {
    const sector = sectorOf.get(w.stockTokenId) ?? 'Unknown';
    bySector.set(sector, (bySector.get(sector) ?? 0) + w.weightBps);
  }
  return [...bySector.entries()]
    .map(([sector, weightBps]) => ({ sector, weightBps }))
    .sort((a, b) => b.weightBps - a.weightBps);
}

/** Concentration metrics on the weight distribution. */
export function computeConcentration(weights: readonly ConstituentWeight[]): ConcentrationResult {
  const sorted = [...weights].map((w) => w.weightBps).sort((a, b) => b - a);
  const top1Bps = sorted[0] ?? 0;
  const top5Bps = sorted.slice(0, 5).reduce((s, x) => s + x, 0);
  const hhi = sorted.reduce((s, bps) => {
    const f = bps / BPS;
    return s + f * f;
  }, 0);
  const effectiveN = hhi > 0 ? 1 / hhi : 0;
  return { top1Bps, top5Bps, hhi: round(hhi, 6), effectiveN: round(effectiveN, 2) };
}

/**
 * One-way turnover between two weight vectors: half the sum of absolute weight
 * changes (the fraction of the book that must trade), in basis points.
 * Constituents present in only one vector count their full weight.
 */
export function computeTurnoverBps(
  oldWeights: readonly ConstituentWeight[],
  newWeights: readonly ConstituentWeight[],
): number {
  const oldMap = new Map(oldWeights.map((w) => [w.stockTokenId, w.weightBps]));
  const newMap = new Map(newWeights.map((w) => [w.stockTokenId, w.weightBps]));
  const ids = new Set([...oldMap.keys(), ...newMap.keys()]);
  let absDiff = 0;
  for (const id of ids) absDiff += Math.abs((newMap.get(id) ?? 0) - (oldMap.get(id) ?? 0));
  return Math.round(absDiff / 2);
}

/** Return over the last `days` of a level series, or null if not enough history. */
function windowReturn(points: readonly PerformancePoint[], days: number): number | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1]!;
  const cutoff = latest.takenAt - days * 86_400_000;
  // The reference point is the last point at or before the cutoff, else the first.
  let ref: PerformancePoint | null = null;
  for (const p of points) {
    if (p.takenAt <= cutoff) ref = p;
    else break;
  }
  const base = ref ?? points[0]!;
  if (base.level <= 0 || base === latest) return null;
  return round(latest.level / base.level - 1, 6);
}

/**
 * Performance over standard windows plus annualized volatility and max drawdown.
 * `points` must be ascending by time. Volatility annualizes the stdev of
 * consecutive-point returns by √(TRADING_DAYS_PER_YEAR); it assumes roughly
 * daily spacing (documented assumption).
 */
export function computePerformance(points: readonly PerformancePoint[]): PerformanceResult {
  const asc = [...points].sort((a, b) => a.takenAt - b.takenAt);
  const latest = asc.length > 0 ? asc[asc.length - 1]! : null;
  const first = asc.length > 0 ? asc[0]! : null;

  const returns: Record<string, number | null> = {
    '1d': windowReturn(asc, 1),
    '7d': windowReturn(asc, 7),
    '30d': windowReturn(asc, 30),
    '90d': windowReturn(asc, 90),
    ytd: null,
  };
  if (latest) {
    const yearStart = Date.UTC(new Date(latest.takenAt).getUTCFullYear(), 0, 1);
    let ytdRef: PerformancePoint | null = null;
    for (const p of asc) {
      if (p.takenAt <= yearStart) ytdRef = p;
      else break;
    }
    const base = ytdRef ?? first;
    if (base && base.level > 0 && base !== latest) {
      returns['ytd'] = round(latest.level / base.level - 1, 6);
    }
  }

  let annualizedVolatility: number | null = null;
  let maxDrawdown: number | null = null;
  if (asc.length >= 2) {
    const rets: number[] = [];
    for (let i = 1; i < asc.length; i++) {
      const prev = asc[i - 1]!.level;
      if (prev > 0) rets.push(asc[i]!.level / prev - 1);
    }
    if (rets.length >= 1) {
      const m = rets.reduce((s, r) => s + r, 0) / rets.length;
      const variance = rets.reduce((s, r) => s + (r - m) * (r - m), 0) / rets.length;
      annualizedVolatility = round(Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR), 6);
    }
    let peak = asc[0]!.level;
    let mdd = 0;
    for (const p of asc) {
      if (p.level > peak) peak = p.level;
      if (peak > 0) mdd = Math.min(mdd, p.level / peak - 1);
    }
    maxDrawdown = round(mdd, 6);
  }

  return {
    returns,
    annualizedVolatility,
    maxDrawdown,
    latestLevel: latest ? round(latest.level, 4) : null,
    firstLevel: first ? round(first.level, 4) : null,
  };
}
