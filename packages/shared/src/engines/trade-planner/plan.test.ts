/**
 * Trade-planner tests: BUY / SELL / REBALANCE produce address-free swap plans
 * whose dollars reconcile exactly, whose slippage floor is set, and whose
 * rebalance trades move a wallet to the target within the no-trade band.
 */
import { describe, expect, it } from 'vitest';
import { planTrades } from './plan.js';
import type { Holding, TargetWeight } from './types.js';

const t = (id: string, bps: number): TargetWeight => ({ stockTokenId: id, ticker: id, weightBps: bps });
const h = (id: string, qty: number): Holding => ({ stockTokenId: id, ticker: id, qty });

/** Deterministic LCG so the reconciliation fuzz is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('planTrades — BUY', () => {
  it('splits cash across priced targets, summing EXACTLY to the cash', () => {
    const plan = planTrades({
      action: 'BUY',
      holdings: [],
      targets: [t('AAPL', 6000), t('MSFT', 4000)],
      prices: { AAPL: 200, MSFT: 400 },
      cashUsd: 1000,
    });
    expect(plan.ok).toBe(true);
    const cents = plan.trades.reduce((s, x) => s + Math.round(x.amountUsd * 100), 0);
    expect(cents).toBe(100000); // $1000, exact
    expect(plan.trades.every((x) => x.side === 'BUY')).toBe(true);
    const byId = new Map(plan.trades.map((x) => [x.ticker, x]));
    expect(byId.get('AAPL')!.amountUsd).toBe(600);
    expect(byId.get('MSFT')!.amountUsd).toBe(400);
    expect(byId.get('AAPL')!.estQty).toBeCloseTo(3, 6); // $600 / $200
    expect(plan.netCashUsd).toBe(1000); // cash the user must supply
    expect(plan.investedUsd).toBe(1000);
  });

  it('drops an unpriced target and renormalizes the rest', () => {
    const plan = planTrades({
      action: 'BUY',
      holdings: [],
      targets: [t('AAPL', 5000), t('MSFT', 5000)],
      prices: { AAPL: 100 }, // MSFT has no price
      cashUsd: 500,
    });
    expect(plan.ok).toBe(true);
    expect(plan.excluded.map((e) => e.ticker)).toEqual(['MSFT']);
    expect(plan.excluded[0]!.reason).toBe('NO_PRICE');
    expect(plan.trades).toHaveLength(1);
    expect(plan.trades[0]!.amountUsd).toBe(500); // AAPL absorbs the full amount
  });

  it('sets minReceived below estQty by the slippage tolerance', () => {
    const plan = planTrades({
      action: 'BUY',
      holdings: [],
      targets: [t('AAPL', 10000)],
      prices: { AAPL: 100 },
      cashUsd: 100,
      slippageBps: 100, // 1%
    });
    const tr = plan.trades[0]!;
    expect(tr.estQty).toBeCloseTo(1, 6);
    expect(tr.minReceived).toBeCloseTo(0.99, 6); // 1 token − 1%
  });

  it('fails with NO_PRICED_TARGETS when nothing is priced', () => {
    const plan = planTrades({
      action: 'BUY',
      holdings: [],
      targets: [t('AAPL', 10000)],
      prices: {},
      cashUsd: 100,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe('NO_PRICED_TARGETS');
  });

  it('rejects non-positive cash', () => {
    expect(planTrades({ action: 'BUY', holdings: [], targets: [t('AAPL', 10000)], prices: { AAPL: 1 }, cashUsd: 0 }).error).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('planTrades — SELL', () => {
  it('turns every priced holding back into cash', () => {
    const plan = planTrades({
      action: 'SELL',
      holdings: [h('AAPL', 3), h('MSFT', 1)],
      targets: [],
      prices: { AAPL: 100, MSFT: 400 },
    });
    expect(plan.ok).toBe(true);
    expect(plan.trades.every((x) => x.side === 'SELL')).toBe(true);
    expect(plan.grossSellUsd).toBe(700); // 3·100 + 1·400
    expect(plan.netCashUsd).toBe(-700); // user receives cash
    const byId = new Map(plan.trades.map((x) => [x.ticker, x]));
    expect(byId.get('AAPL')!.estQty).toBe(3);
    expect(byId.get('AAPL')!.minReceived).toBeCloseTo(300 * (1 - 0.005), 6); // default 0.5%
  });

  it('surfaces an unpriced holding and sells the rest', () => {
    const plan = planTrades({
      action: 'SELL',
      holdings: [h('AAPL', 1), h('MSFT', 1)],
      targets: [],
      prices: { AAPL: 100 }, // MSFT unpriced
    });
    expect(plan.ok).toBe(true);
    expect(plan.trades.map((x) => x.ticker)).toEqual(['AAPL']);
    expect(plan.excluded[0]!.ticker).toBe('MSFT');
  });

  it('fails with NOTHING_TO_TRADE when no holding is priced', () => {
    const plan = planTrades({ action: 'SELL', holdings: [h('AAPL', 1)], targets: [], prices: {} });
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe('NOTHING_TO_TRADE');
    expect(plan.excluded[0]!.reason).toBe('NO_PRICE');
  });
});

describe('planTrades — REBALANCE', () => {
  it('trades only the difference and nets to ~0 with no added cash', () => {
    // Hold $800 AAPL + $200 MSFT (= $1000); target 50/50 → sell $300 AAPL, buy $300 MSFT.
    const plan = planTrades({
      action: 'REBALANCE',
      holdings: [h('AAPL', 8), h('MSFT', 2)],
      targets: [t('AAPL', 5000), t('MSFT', 5000)],
      prices: { AAPL: 100, MSFT: 100 },
      rebalanceBandBps: 0,
      dustUsd: 0,
    });
    expect(plan.ok).toBe(true);
    const byId = new Map(plan.trades.map((x) => [x.ticker, x]));
    expect(byId.get('AAPL')!.side).toBe('SELL');
    expect(byId.get('AAPL')!.amountUsd).toBe(300);
    expect(byId.get('MSFT')!.side).toBe('BUY');
    expect(byId.get('MSFT')!.amountUsd).toBe(300);
    expect(Math.abs(plan.netCashUsd)).toBeLessThanOrEqual(0.01);
    expect(plan.trades[0]!.side).toBe('SELL'); // sells ordered first (fund the buys)
  });

  it('deploys added cash, netting ~ the cash added', () => {
    const plan = planTrades({
      action: 'REBALANCE',
      holdings: [h('AAPL', 5)], // $500
      targets: [t('AAPL', 5000), t('MSFT', 5000)],
      prices: { AAPL: 100, MSFT: 100 },
      cashUsd: 500,
      rebalanceBandBps: 0,
      dustUsd: 0,
    });
    expect(plan.ok).toBe(true);
    expect(plan.trades).toHaveLength(1); // AAPL already on target; only MSFT bought
    expect(plan.trades[0]!.ticker).toBe('MSFT');
    expect(plan.trades[0]!.side).toBe('BUY');
    expect(plan.trades[0]!.amountUsd).toBe(500);
    expect(plan.netCashUsd).toBe(500);
    expect(plan.investedUsd).toBe(1000);
  });

  it('sells a name dropped from the target down to zero', () => {
    const plan = planTrades({
      action: 'REBALANCE',
      holdings: [h('AAPL', 5), h('OLD', 5)],
      targets: [t('AAPL', 10000)],
      prices: { AAPL: 100, OLD: 100 },
      rebalanceBandBps: 0,
      dustUsd: 0,
    });
    const byId = new Map(plan.trades.map((x) => [x.ticker, x]));
    expect(byId.get('OLD')!.side).toBe('SELL');
    expect(byId.get('OLD')!.amountUsd).toBe(500);
    expect(byId.get('AAPL')!.side).toBe('BUY');
    expect(byId.get('AAPL')!.amountUsd).toBe(500);
  });

  it('leaves a book within the no-trade band untouched (ALREADY_BALANCED)', () => {
    // ~50/50 with 0.1% drift; default band 0.5% ⇒ no trades.
    const plan = planTrades({
      action: 'REBALANCE',
      holdings: [h('AAPL', 5.01), h('MSFT', 4.99)],
      targets: [t('AAPL', 5000), t('MSFT', 5000)],
      prices: { AAPL: 100, MSFT: 100 },
    });
    expect(plan.ok).toBe(true);
    expect(plan.trades).toHaveLength(0);
    expect(plan.note).toBe('ALREADY_BALANCED');
  });

  it('reconciles: applying the plan moves every name to its target (fuzz)', () => {
    const rand = lcg(4663);
    let checked = 0;
    for (let k = 0; k < 250; k++) {
      const n = 2 + Math.floor(rand() * 5);
      const prices: Record<string, number> = {};
      const holdings: Holding[] = [];
      const targets: TargetWeight[] = [];
      for (let i = 0; i < n; i++) {
        const id = `S${i}`;
        prices[id] = Math.round((1 + rand() * 1000) * 100) / 100;
        holdings.push(h(id, Math.round(rand() * 20 * 100) / 100));
        targets.push(t(id, 1 + Math.floor(rand() * 9999)));
      }
      const plan = planTrades({
        action: 'REBALANCE',
        holdings,
        targets,
        prices,
        rebalanceBandBps: 0,
        dustUsd: 0,
      });
      if (!plan.ok) continue;
      checked++;
      const usd = new Map<string, number>();
      for (const hh of holdings) usd.set(hh.stockTokenId, (usd.get(hh.stockTokenId) ?? 0) + hh.qty * prices[hh.stockTokenId]!);
      for (const tr of plan.trades) {
        const d = tr.side === 'BUY' ? tr.amountUsd : -tr.amountUsd;
        usd.set(tr.stockTokenId, (usd.get(tr.stockTokenId) ?? 0) + d);
      }
      const target = new Map(plan.targetUsd.map((x) => [x.stockTokenId, x.usd]));
      for (const [id, v] of usd) {
        expect(Math.abs(v - (target.get(id) ?? 0))).toBeLessThan(0.02);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
