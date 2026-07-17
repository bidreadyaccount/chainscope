import { describe, it, expect } from 'vitest';
import { toRawAmount } from '../../utils/amount.js';
import { computePosition } from './cost-basis.js';
import type { PnlInput, PnlTradeEvent } from './types.js';

const T0 = Date.UTC(2025, 0, 1, 0, 0, 0);
const min = (n: number) => T0 + n * 60_000;

function buy(qty: number, usd: number | null, decimals: number, at: number): PnlTradeEvent {
  return {
    side: 'BUY',
    kind: 'SWAP',
    tokenAmountRaw: toRawAmount(qty, decimals),
    quoteValueUsd: usd,
    timestamp: at,
  };
}
function sell(qty: number, usd: number | null, decimals: number, at: number): PnlTradeEvent {
  return {
    side: 'SELL',
    kind: 'SWAP',
    tokenAmountRaw: toRawAmount(qty, decimals),
    quoteValueUsd: usd,
    timestamp: at,
  };
}
function transferIn(qty: number, decimals: number, at: number): PnlTradeEvent {
  return {
    side: 'BUY',
    kind: 'TRANSFER_IN',
    tokenAmountRaw: toRawAmount(qty, decimals),
    quoteValueUsd: null,
    timestamp: at,
  };
}

describe('computePosition — single buy then sell (hand-computed, 18 decimals)', () => {
  const decimals = 18;
  const input: PnlInput = {
    decimals,
    currentPriceUsd: 12,
    events: [buy(100, 1_000, decimals, min(0)), sell(40, 480, decimals, min(10))],
  };
  const r = computePosition(input);

  it('avg entry cost = $10/token', () => {
    // 100 tokens for $1000 → $10 each.
    expect(r.avgEntryCostUsd).toBeCloseTo(10, 6);
  });

  it('realized P&L = proceeds - cost of sold portion = 480 - 400 = 80', () => {
    expect(r.realizedPnlUsd).toBeCloseTo(80, 6);
  });

  it('remaining tracked cost basis = $600 (60 tokens @ $10)', () => {
    expect(r.costBasisUsd).toBeCloseTo(600, 6);
  });

  it('unrealized P&L = 60*12 - 600 = 120', () => {
    expect(r.unrealizedPnlUsd).toBeCloseTo(120, 6);
  });

  it('current qty = 60 tokens', () => {
    expect(r.currentQtyHuman).toBeCloseTo(60, 6);
    expect(r.currentQtyRaw).toBe(BigInt(toRawAmount(60, decimals)));
  });

  it('total return = realized + unrealized = 200; total invested = 1000; return 20%', () => {
    expect(r.totalReturnUsd).toBeCloseTo(200, 6);
    expect(r.totalInvestedUsd).toBeCloseTo(1_000, 6);
    expect(r.totalReturnPct).toBeCloseTo(20, 4);
  });

  it('one winning closed lot, no losses', () => {
    expect(r.winningClosed).toBe(1);
    expect(r.losingClosed).toBe(0);
  });

  it('is complete (no incompleteness flags)', () => {
    expect(r.incomplete).toBe(false);
    expect(r.incompleteReasons).toHaveLength(0);
  });
});

describe('computePosition — multi-buy weighted average (6 decimals)', () => {
  const decimals = 6;
  // Buy 100 @ $1 (=$100), buy 100 @ $3 (=$300) → 200 tokens, $400, avg $2.
  const r = computePosition({
    decimals,
    currentPriceUsd: 2,
    events: [buy(100, 100, decimals, min(0)), buy(100, 300, decimals, min(5))],
  });

  it('weighted-average cost = $2/token', () => {
    expect(r.avgEntryCostUsd).toBeCloseTo(2, 6);
  });

  it('cost basis $400, invested $400, unrealized 0 at mark $2', () => {
    expect(r.costBasisUsd).toBeCloseTo(400, 6);
    expect(r.totalInvestedUsd).toBeCloseTo(400, 6);
    expect(r.unrealizedPnlUsd).toBeCloseTo(0, 6);
  });
});

describe('computePosition — multi-buy multi-sell sequence (8 decimals)', () => {
  const decimals = 8;
  // Buy 100 @ $10 ($1000), buy 100 @ $20 ($2000) → 200 @ avg $15.
  // Sell 50 @ $30 ($1500 proceeds) → cost 50*15=750 → realized +750.
  // Sell 150 @ $12 ($1800 proceeds) → cost 150*15=2250 → realized -450.
  const events = [
    buy(100, 1_000, decimals, min(0)),
    buy(100, 2_000, decimals, min(1)),
    sell(50, 1_500, decimals, min(2)),
    sell(150, 1_800, decimals, min(3)),
  ];
  const r = computePosition({ decimals, currentPriceUsd: 12, events });

  it('net realized P&L = 750 - 450 = 300', () => {
    expect(r.realizedPnlUsd).toBeCloseTo(300, 4);
  });

  it('fully exited: current qty 0, cost basis 0', () => {
    expect(r.currentQtyHuman).toBeCloseTo(0, 8);
    expect(r.costBasisUsd).toBeCloseTo(0, 4);
    expect(r.currentQtyRaw).toBe(0n);
  });

  it('one winning and one losing closed lot', () => {
    expect(r.winningClosed).toBe(1);
    expect(r.losingClosed).toBe(1);
  });

  it('unrealized P&L is 0 when nothing is held', () => {
    expect(r.unrealizedPnlUsd).toBeCloseTo(0, 4);
  });
});

describe('computePosition — transfers are not purchases', () => {
  const decimals = 18;
  it('transfer-in adds balance but not cost basis; marked incomplete', () => {
    const r = computePosition({
      decimals,
      currentPriceUsd: 5,
      events: [transferIn(100, decimals, min(0)), buy(100, 200, decimals, min(1))],
    });
    // Only the purchased 100 @ $2 form the cost basis.
    expect(r.avgEntryCostUsd).toBeCloseTo(2, 6);
    expect(r.totalInvestedUsd).toBeCloseTo(200, 6);
    // Balance is 200 (100 transferred + 100 bought).
    expect(r.currentQtyHuman).toBeCloseTo(200, 6);
    expect(r.transferInRaw).toBe(BigInt(toRawAmount(100, decimals)));
    expect(r.incomplete).toBe(true);
    expect(r.incompleteReasons).toContain('transfer_in_untracked_cost');
  });
});

describe('computePosition — sells exceeding tracked inventory', () => {
  const decimals = 18;
  it('selling more than purchased realizes only the tracked portion and flags incomplete', () => {
    // Transfer in 100 (no cost), buy 50 @ $10 ($500). Then sell 100 @ $15 ($1500).
    const r = computePosition({
      decimals,
      currentPriceUsd: 15,
      events: [
        transferIn(100, decimals, min(0)),
        buy(50, 500, decimals, min(1)),
        sell(100, 1_500, decimals, min(2)),
      ],
    });
    // Tracked portion sold = 50 tokens: proceeds attributable = 1500 * (50/100) = 750.
    // Cost of 50 tracked @ $10 = 500 → realized = 250.
    expect(r.realizedPnlUsd).toBeCloseTo(250, 4);
    expect(r.incomplete).toBe(true);
    expect(r.incompleteReasons).toContain('sell_exceeds_tracked_inventory');
    // Balance = 100 + 50 - 100 = 50 tokens remain (all untracked).
    expect(r.currentQtyHuman).toBeCloseTo(50, 6);
  });
});

describe('computePosition — zero / unknown price legs', () => {
  const decimals = 6;
  it('zero-price buy adds qty with no cost and flags incomplete', () => {
    const r = computePosition({
      decimals,
      currentPriceUsd: 1,
      events: [buy(100, null, decimals, min(0))],
    });
    expect(r.costBasisUsd).toBe(0);
    expect(r.avgEntryCostUsd).toBeCloseTo(0, 6);
    expect(r.incompleteReasons).toContain('zero_price_buy');
  });

  it('unknown-price sell does not fabricate realized P&L; flags incomplete', () => {
    const r = computePosition({
      decimals,
      currentPriceUsd: 1,
      events: [buy(100, 100, decimals, min(0)), sell(50, null, decimals, min(1))],
    });
    expect(r.realizedPnlUsd).toBe(0);
    expect(r.incompleteReasons).toContain('zero_price_sell');
    // Tracked qty is still reduced by the sold amount.
    expect(r.currentQtyHuman).toBeCloseTo(50, 6);
  });
});

describe('computePosition — unpriced mark and timing', () => {
  const decimals = 18;
  it('null current price → unrealized null and open position flagged', () => {
    const r = computePosition({
      decimals,
      currentPriceUsd: null,
      events: [buy(100, 1_000, decimals, min(0))],
    });
    expect(r.unrealizedPnlUsd).toBeNull();
    expect(r.totalReturnUsd).toBeNull();
    expect(r.currentValueUsd).toBeNull();
    expect(r.incompleteReasons).toContain('unpriced_open_position');
  });

  it('records first entry, last trade and a non-negative avg holding period', () => {
    const r = computePosition({
      decimals,
      currentPriceUsd: 12,
      events: [buy(100, 1_000, decimals, min(0)), sell(100, 1_500, decimals, min(30))],
    });
    expect(r.firstEntryAt).toBe(min(0));
    expect(r.lastTradeAt).toBe(min(30));
    // Held ~30 minutes = 1800s.
    expect(r.avgHoldingPeriodSeconds).toBeCloseTo(1_800, 1);
  });

  it('empty event list yields a zeroed, non-incomplete-by-inventory state', () => {
    const r = computePosition({ decimals, currentPriceUsd: 10, events: [] });
    expect(r.currentQtyRaw).toBe(0n);
    expect(r.realizedPnlUsd).toBe(0);
    expect(r.avgEntryCostUsd).toBeNull();
  });

  it('sorts out-of-order events by timestamp', () => {
    const ordered = computePosition({
      decimals,
      currentPriceUsd: 12,
      events: [buy(100, 1_000, decimals, min(0)), sell(40, 480, decimals, min(10))],
    });
    const shuffled = computePosition({
      decimals,
      currentPriceUsd: 12,
      events: [sell(40, 480, decimals, min(10)), buy(100, 1_000, decimals, min(0))],
    });
    expect(shuffled).toEqual(ordered);
  });
});
