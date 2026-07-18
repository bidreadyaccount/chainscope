/**
 * Trade planner (the maths behind the buyable "Basket Router", see
 * docs/handoff/BASKET_ROUTER.md). Pure, deterministic, I/O-free: turns a desired
 * basket plus a user's current wallet into an abstract list of buy/sell swaps for
 * one of three actions — BUY, SELL (full exit) and REBALANCE (diff-to-target).
 *
 * It never sees or emits a contract address; the on-chain router maps
 * `stockTokenId` → a real, operator-configured address at execution time. Dollar
 * splits use the same identity-stable largest-remainder rounder (`apportion`) as
 * the index simulator, so a BUY's dollars sum EXACTLY to the cash in.
 */

import { apportion } from '../math.js';
import { largestRemainderBps } from '../index-engine/index.js';
import type {
  ExcludedName,
  Holding,
  PlanExclusionReason,
  PlanInput,
  PlannedTrade,
  TargetUsd,
  TargetWeight,
  TradeAction,
  TradePlan,
} from './types.js';

export const DEFAULT_SLIPPAGE_BPS = 50;
export const DEFAULT_REBALANCE_BAND_BPS = 50;
export const DEFAULT_DUST_USD = 0.01;
const BPS = 10000;

/** A usable USD price for a token, or the reason it isn't tradable. */
function usablePrice(
  prices: Readonly<Record<string, number>>,
  id: string,
): { price: number } | { reason: PlanExclusionReason } {
  const v = prices[id];
  if (v === undefined || v === null) return { reason: 'NO_PRICE' };
  if (!Number.isFinite(v) || v <= 0) return { reason: 'NON_FINITE_PRICE' };
  return { price: v };
}

/** Aggregate duplicate holdings by id (sum qty), first-seen ticker/order kept. */
function aggregateHoldings(
  holdings: readonly Holding[],
): Array<{ stockTokenId: string; ticker: string; qty: number }> {
  const byId = new Map<string, { stockTokenId: string; ticker: string; qty: number }>();
  for (const h of holdings) {
    const qty = Number.isFinite(h.qty) && h.qty > 0 ? h.qty : 0;
    const ex = byId.get(h.stockTokenId);
    if (ex) ex.qty += qty;
    else byId.set(h.stockTokenId, { stockTokenId: h.stockTokenId, ticker: h.ticker, qty });
  }
  return [...byId.values()];
}

interface PricedTarget {
  stockTokenId: string;
  ticker: string;
  weightBps: number;
  price: number;
}

/**
 * Resolve targets to those with a usable price. Duplicate ids are aggregated
 * (summed weight), non-positive/non-finite target weights are ignored, and
 * unpriced names are surfaced as exclusions.
 */
function resolveTargets(
  targets: readonly TargetWeight[],
  prices: Readonly<Record<string, number>>,
): { priced: PricedTarget[]; excluded: ExcludedName[] } {
  const byId = new Map<string, { stockTokenId: string; ticker: string; weightBps: number }>();
  for (const t of targets) {
    if (!Number.isFinite(t.weightBps) || t.weightBps <= 0) continue;
    const ex = byId.get(t.stockTokenId);
    if (ex) ex.weightBps += t.weightBps;
    else
      byId.set(t.stockTokenId, {
        stockTokenId: t.stockTokenId,
        ticker: t.ticker,
        weightBps: t.weightBps,
      });
  }
  const priced: PricedTarget[] = [];
  const excluded: ExcludedName[] = [];
  for (const t of byId.values()) {
    const pr = usablePrice(prices, t.stockTokenId);
    if ('reason' in pr)
      excluded.push({ stockTokenId: t.stockTokenId, ticker: t.ticker, reason: pr.reason });
    else priced.push({ ...t, price: pr.price });
  }
  return { priced, excluded };
}

/** Renormalize priced target weights to bps summing to EXACTLY 10000. */
function renormalizeBps(priced: readonly PricedTarget[]): number[] {
  const s = priced.reduce((acc, p) => acc + p.weightBps, 0);
  if (s <= 0) return priced.map(() => 0);
  return largestRemainderBps(priced.map((p) => ({ id: p.stockTokenId, fraction: p.weightBps / s })));
}

function fail(
  action: TradeAction,
  error: TradePlan['error'],
  slippageBps: number,
  excluded: ExcludedName[] = [],
): TradePlan {
  return {
    action,
    ok: false,
    error,
    trades: [],
    grossBuyUsd: 0,
    grossSellUsd: 0,
    netCashUsd: 0,
    investedUsd: 0,
    targetUsd: [],
    excluded,
    slippageBps,
  };
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Assemble a successful plan: deterministic order, gross/net from cents, invariant checks. */
function makePlan(params: {
  action: TradeAction;
  trades: PlannedTrade[];
  excluded: ExcludedName[];
  targetUsd: TargetUsd[];
  investedUsd: number;
  slippageBps: number;
  note?: TradePlan['note'];
}): TradePlan {
  const trades = params.trades
    .filter((t) => Number.isFinite(t.amountUsd) && t.amountUsd > 0 && t.estQty > 0)
    .sort((a, b) =>
      a.side !== b.side
        ? a.side === 'SELL'
          ? -1
          : 1
        : a.ticker < b.ticker
          ? -1
          : a.ticker > b.ticker
            ? 1
            : 0,
    );
  let buyCents = 0;
  let sellCents = 0;
  for (const t of trades) {
    const c = Math.round(t.amountUsd * 100);
    if (t.side === 'BUY') buyCents += c;
    else sellCents += c;
  }
  const grossBuyUsd = buyCents / 100;
  const grossSellUsd = sellCents / 100;
  return {
    action: params.action,
    ok: true,
    ...(params.note ? { note: params.note } : {}),
    trades,
    grossBuyUsd,
    grossSellUsd,
    netCashUsd: money(grossBuyUsd - grossSellUsd),
    investedUsd: money(params.investedUsd),
    targetUsd: params.targetUsd,
    excluded: params.excluded,
    slippageBps: params.slippageBps,
  };
}

function buyTrade(p: PricedTarget, amountUsd: number, slipFactor: number): PlannedTrade {
  const estQty = amountUsd / p.price;
  return {
    stockTokenId: p.stockTokenId,
    ticker: p.ticker,
    side: 'BUY',
    amountUsd,
    estQty,
    priceUsd: p.price,
    minReceived: estQty * slipFactor, // min tokens out
  };
}

function planBuy(input: PlanInput, slippageBps: number): TradePlan {
  const cash = input.cashUsd ?? 0;
  // Reject sub-cent cash too: it apportions to 0 cents and would otherwise return an
  // empty "success" with no signal (audit F2, mirrors the /simulate $0.01 floor).
  if (!Number.isFinite(cash) || Math.round(cash * 100) < 1)
    return fail('BUY', 'INVALID_INPUT', slippageBps);

  const { priced, excluded } = resolveTargets(input.targets, input.prices);
  if (priced.length === 0) return fail('BUY', 'NO_PRICED_TARGETS', slippageBps, excluded);

  const realizedBps = renormalizeBps(priced);
  const cents = apportion(
    Math.round(cash * 100),
    realizedBps,
    priced.map((p) => p.stockTokenId),
  );
  const slipFactor = 1 - slippageBps / BPS;
  const trades: PlannedTrade[] = [];
  const targetUsd: TargetUsd[] = [];
  for (let i = 0; i < priced.length; i++) {
    const p = priced[i]!;
    const amountUsd = cents[i]! / 100;
    targetUsd.push({ stockTokenId: p.stockTokenId, ticker: p.ticker, usd: amountUsd });
    // Skip only zero-cent slices; never drop a positive cent slice, so a BUY always
    // conserves the cash EXACTLY regardless of dustUsd (audit F3).
    if (amountUsd <= 0) continue;
    trades.push(buyTrade(p, amountUsd, slipFactor));
  }
  return makePlan({ action: 'BUY', trades, excluded, targetUsd, investedUsd: cash, slippageBps });
}

function planSell(input: PlanInput, slippageBps: number, dustUsd: number): TradePlan {
  const slipFactor = 1 - slippageBps / BPS;
  const trades: PlannedTrade[] = [];
  const excluded: ExcludedName[] = [];
  for (const h of aggregateHoldings(input.holdings)) {
    if (!(h.qty > 0)) continue;
    const pr = usablePrice(input.prices, h.stockTokenId);
    if ('reason' in pr) {
      excluded.push({ stockTokenId: h.stockTokenId, ticker: h.ticker, reason: pr.reason });
      continue;
    }
    const amountUsd = h.qty * pr.price;
    if (!Number.isFinite(amountUsd) || amountUsd < dustUsd) continue; // finite guard (audit F5)
    trades.push({
      stockTokenId: h.stockTokenId,
      ticker: h.ticker,
      side: 'SELL',
      amountUsd,
      estQty: h.qty,
      priceUsd: pr.price,
      minReceived: amountUsd * slipFactor, // min USD out
    });
  }
  if (trades.length === 0) return fail('SELL', 'NOTHING_TO_TRADE', slippageBps, excluded);
  return makePlan({ action: 'SELL', trades, excluded, targetUsd: [], investedUsd: 0, slippageBps });
}

function planRebalance(
  input: PlanInput,
  slippageBps: number,
  bandBps: number,
  dustUsd: number,
): TradePlan {
  const cash = input.cashUsd ?? 0;
  if (!Number.isFinite(cash) || cash < 0) return fail('REBALANCE', 'INVALID_INPUT', slippageBps);

  const excluded: ExcludedName[] = [];
  const currentUsd = new Map<string, number>();
  const priceOf = new Map<string, number>();
  const tickerOf = new Map<string, string>();
  let heldPricedUsd = 0;
  for (const h of aggregateHoldings(input.holdings)) {
    tickerOf.set(h.stockTokenId, h.ticker);
    if (!(h.qty > 0)) continue;
    const pr = usablePrice(input.prices, h.stockTokenId);
    if ('reason' in pr) {
      excluded.push({ stockTokenId: h.stockTokenId, ticker: h.ticker, reason: pr.reason });
      continue;
    }
    const usd = h.qty * pr.price;
    currentUsd.set(h.stockTokenId, (currentUsd.get(h.stockTokenId) ?? 0) + usd);
    priceOf.set(h.stockTokenId, pr.price);
    heldPricedUsd += usd;
  }

  const portfolioUsd = heldPricedUsd + cash;
  if (!(portfolioUsd > 0) || !Number.isFinite(portfolioUsd))
    return fail('REBALANCE', 'INVALID_INPUT', slippageBps, excluded);

  const { priced, excluded: targetExcluded } = resolveTargets(input.targets, input.prices);
  for (const e of targetExcluded)
    if (!excluded.some((x) => x.stockTokenId === e.stockTokenId)) excluded.push(e);
  if (priced.length === 0) return fail('REBALANCE', 'NO_PRICED_TARGETS', slippageBps, excluded);
  for (const p of priced) {
    priceOf.set(p.stockTokenId, p.price);
    tickerOf.set(p.stockTokenId, p.ticker);
  }

  const realizedBps = renormalizeBps(priced);
  const tgtCents = apportion(
    Math.round(portfolioUsd * 100),
    realizedBps,
    priced.map((p) => p.stockTokenId),
  );
  const targetUsdMap = new Map<string, number>();
  const targetUsd: TargetUsd[] = [];
  for (let i = 0; i < priced.length; i++) {
    const usd = tgtCents[i]! / 100;
    targetUsdMap.set(priced[i]!.stockTokenId, usd);
    targetUsd.push({ stockTokenId: priced[i]!.stockTokenId, ticker: priced[i]!.ticker, usd });
  }

  const band = portfolioUsd * (bandBps / BPS);
  const slipFactor = 1 - slippageBps / BPS;
  const ids = new Set<string>([...currentUsd.keys(), ...targetUsdMap.keys()]);
  const trades: PlannedTrade[] = [];
  for (const id of ids) {
    const cur = currentUsd.get(id) ?? 0;
    const tgt = targetUsdMap.get(id) ?? 0; // held but not in target ⇒ sell to zero
    const delta = tgt - cur;
    const mag = Math.abs(delta);
    // Zero delta or within-band ⇒ leave alone. Skipping the exact-zero case keeps it out
    // of the trade list so an on-target book reports ALREADY_BALANCED (audit F1).
    if (!(mag > 0) || mag < band || mag < dustUsd) continue;
    const price = priceOf.get(id)!;
    const ticker = tickerOf.get(id) ?? id;
    const estQty = mag / price;
    trades.push({
      stockTokenId: id,
      ticker,
      side: delta > 0 ? 'BUY' : 'SELL',
      amountUsd: mag,
      estQty,
      priceUsd: price,
      minReceived: delta > 0 ? estQty * slipFactor : mag * slipFactor,
    });
  }

  return makePlan({
    action: 'REBALANCE',
    trades,
    excluded,
    targetUsd,
    investedUsd: portfolioUsd,
    slippageBps,
    ...(trades.length === 0 ? { note: 'ALREADY_BALANCED' as const } : {}),
  });
}

/**
 * Plan the swaps for a basket action. Returns an abstract, address-free
 * `TradePlan` (a list of BUY/SELL swaps with slippage-protected `minReceived`),
 * or `ok:false` with a reason when no actionable plan exists.
 */
export function planTrades(input: PlanInput): TradePlan {
  const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const bandBps = input.rebalanceBandBps ?? DEFAULT_REBALANCE_BAND_BPS;
  const dustUsd = input.dustUsd ?? DEFAULT_DUST_USD;

  if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps >= BPS)
    return fail(input.action, 'INVALID_INPUT', DEFAULT_SLIPPAGE_BPS);
  if (!Number.isFinite(bandBps) || bandBps < 0) return fail(input.action, 'INVALID_INPUT', slippageBps);
  if (!Number.isFinite(dustUsd) || dustUsd < 0) return fail(input.action, 'INVALID_INPUT', slippageBps);

  switch (input.action) {
    case 'BUY':
      return planBuy(input, slippageBps);
    case 'SELL':
      return planSell(input, slippageBps, dustUsd);
    case 'REBALANCE':
      return planRebalance(input, slippageBps, bandBps, dustUsd);
    default:
      return fail(input.action, 'INVALID_INPUT', slippageBps);
  }
}
