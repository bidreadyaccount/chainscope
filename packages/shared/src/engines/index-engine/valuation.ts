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
  ExcludedHolding,
  LevelResult,
  PerformancePoint,
  PerformanceResult,
  SectorAllocation,
} from './types.js';

const BPS = WEIGHT_DENOMINATOR_BPS;
const DAY_MS = 86_400_000;

function usablePrice(p: number | null | undefined): number | null {
  return p !== null && p !== undefined && Number.isFinite(p) && p > 0 ? p : null;
}

/**
 * Build the notional basket that realizes `weights` at the given prices, scaled
 * so the invested basket's NAV = level = baseValue at inception (divisor = 1).
 *
 * Hardened after audit V-01: constituents with no usable price are NOT silently
 * given zero shares while keeping their weight. They are excluded and surfaced
 * in `excluded`, and the remaining (priced) weights are renormalized so the
 * basket is fully invested and its level starts exactly at baseValue.
 * `investedWeightBps` (< 10000 iff something was excluded) makes the condition
 * explicit to callers.
 */
export function buildBasket(
  weights: readonly ConstituentWeight[],
  prices: ReadonlyMap<string, number | null>,
  baseValue: number,
): Basket {
  const priced: ConstituentWeight[] = [];
  const excluded: ExcludedHolding[] = [];
  for (const w of weights) {
    const raw = prices.get(w.stockTokenId);
    if (usablePrice(raw) === null) {
      excluded.push({
        stockTokenId: w.stockTokenId,
        ticker: w.ticker,
        weightBps: w.weightBps,
        reason: raw === null || raw === undefined ? 'MISSING_PRICE' : 'NON_FINITE_PRICE',
      });
    } else {
      priced.push(w);
    }
  }

  const investedWeightBps = priced.reduce((s, w) => s + w.weightBps, 0);
  if (priced.length === 0 || investedWeightBps <= 0) {
    return { holdings: [], excluded, investedWeightBps: 0, divisor: 1, navUsd: 0, level: 0 };
  }

  // Renormalize invested weights to 100% so the priced basket starts at baseValue.
  const holdings = priced.map((w) => {
    const price = usablePrice(prices.get(w.stockTokenId))!;
    const targetUsd = (w.weightBps / investedWeightBps) * baseValue;
    return {
      stockTokenId: w.stockTokenId,
      ticker: w.ticker,
      shares: targetUsd / price,
      weightBps: w.weightBps,
    };
  });
  const navUsd = holdings.reduce(
    (s, h) => s + h.shares * usablePrice(prices.get(h.stockTokenId))!,
    0,
  );
  const divisor = 1;
  return {
    holdings,
    excluded,
    investedWeightBps,
    divisor,
    navUsd: round(navUsd, 2),
    level: round(navUsd / divisor, 4),
  };
}

/**
 * Recompute level for an existing basket at new prices. A holding whose price is
 * missing/non-finite at valuation time contributes 0 (its shares are known but
 * unpriceable now); this is a mark-to-market gap, distinct from inception
 * exclusion. Callers can detect it via a level below expectation.
 */
export function computeLevel(
  basket: Basket,
  prices: ReadonlyMap<string, number | null>,
): LevelResult {
  const navUsd = basket.holdings.reduce((s, h) => {
    const price = usablePrice(prices.get(h.stockTokenId));
    return s + h.shares * (price ?? 0);
  }, 0);
  return { navUsd: round(navUsd, 2), level: round(navUsd / basket.divisor, 4) };
}

/**
 * Portfolio simulator: given an investment amount, target weights and current
 * prices, return the per-constituent allocation (USD + fractional shares) and,
 * when an index level series is supplied, the value the same investment would
 * have had over that series (amount · level_t / level_0). Uses `buildBasket`, so
 * unpriced constituents are surfaced (not silently dropped) and the invested
 * portion is renormalized.
 */
export function simulateInvestment(
  amountUsd: number,
  weights: readonly ConstituentWeight[],
  prices: ReadonlyMap<string, number | null>,
  levelSeries: readonly PerformancePoint[] = [],
): {
  amountUsd: number;
  investedWeightBps: number;
  allocations: Array<{
    stockTokenId: string;
    ticker: string;
    weightBps: number;
    allocationUsd: number;
    shares: number;
    priceUsd: number;
  }>;
  excluded: Basket['excluded'];
  valueSeries: Array<{ takenAt: number; valueUsd: number }>;
  finalValueUsd: number | null;
  totalReturn: number | null;
} {
  const amount = Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : 0;
  const basket = buildBasket(weights, prices, amount);
  const allocations = basket.holdings.map((h) => {
    const price = usablePrice(prices.get(h.stockTokenId))!;
    return {
      stockTokenId: h.stockTokenId,
      ticker: h.ticker,
      weightBps: h.weightBps,
      allocationUsd: round(h.shares * price, 2),
      shares: round(h.shares, 6),
      priceUsd: price,
    };
  });

  const asc = [...levelSeries].sort((a, b) => a.takenAt - b.takenAt);
  const first = asc.find((p) => p.level > 0) ?? null;
  const valueSeries =
    first && amount > 0
      ? asc.map((p) => ({
          takenAt: p.takenAt,
          valueUsd: round((amount * p.level) / first.level, 2),
        }))
      : [];
  const finalValueUsd =
    valueSeries.length > 0 ? valueSeries[valueSeries.length - 1]!.valueUsd : null;
  const totalReturn =
    finalValueUsd !== null && amount > 0 ? round(finalValueUsd / amount - 1, 6) : null;

  return {
    amountUsd: amount,
    investedWeightBps: basket.investedWeightBps,
    allocations,
    excluded: basket.excluded,
    valueSeries,
    finalValueUsd,
    totalReturn,
  };
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

/**
 * Return over the last `days` of a level series, or null when the series does
 * not actually cover that horizon.
 *
 * Hardened after audit V-02: the reference is the last point at/before the
 * cutoff, and it is REJECTED (null) when (a) the series does not reach back to
 * the cutoff at all, or (b) the reference is materially staler than requested
 * (sparse data) — so a 10-hour or 10-day move is never mislabeled as a "1d"
 * return. Tolerance = max(2 days, 50% of the window).
 */
function windowReturn(points: readonly PerformancePoint[], days: number): number | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1]!;
  const cutoff = latest.takenAt - days * DAY_MS;
  let ref: PerformancePoint | null = null;
  for (const p of points) {
    if (p.takenAt <= cutoff) ref = p;
    else break;
  }
  if (ref === null) return null; // series does not span the window
  const lookbackDays = (latest.takenAt - ref.takenAt) / DAY_MS;
  const toleranceDays = Math.max(2, days * 0.5);
  if (lookbackDays > days + toleranceDays) return null; // reference too stale
  if (ref.level <= 0 || ref === latest) return null;
  return round(latest.level / ref.level - 1, 6);
}

/**
 * Performance over standard windows plus annualized volatility and max drawdown.
 * Volatility annualizes the stdev of consecutive-point returns by
 * √(TRADING_DAYS_PER_YEAR), assuming roughly daily spacing (documented). Points
 * are sorted ascending and de-duplicated by timestamp (last-write-wins) so
 * duplicate observations cannot create spurious zero-interval returns (audit
 * S-02).
 */
export function computePerformance(points: readonly PerformancePoint[]): PerformanceResult {
  const byTime = new Map<number, PerformancePoint>();
  for (const p of [...points].sort((a, b) => a.takenAt - b.takenAt)) byTime.set(p.takenAt, p);
  const asc = [...byTime.values()];
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
    // YTD requires a real year-start reference; if the series starts after Jan 1
    // there is no YTD to report (the UI shows "since inception" separately).
    if (ytdRef && ytdRef.level > 0 && ytdRef !== latest) {
      returns['ytd'] = round(latest.level / ytdRef.level - 1, 6);
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
