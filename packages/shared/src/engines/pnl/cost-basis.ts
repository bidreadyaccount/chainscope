import { fromRawAmount } from '../../utils/amount.js';
import { round } from '../math.js';
import type { PnlInput, PnlTradeEvent, PositionState } from './types.js';

/**
 * Weighted-average (moving-average) cost-basis P&L for one wallet-token
 * position (SPEC §9). Processes a chronological event sequence into a full
 * position state.
 *
 * Rules:
 *  - Only SWAP buys establish cost basis. TRANSFER_IN adds balance but no cost
 *    ("do not count transfers into a wallet as profitable purchases").
 *  - Selling more than the tracked (purchased) inventory implies untracked
 *    inventory (e.g. transferred in): the tracked portion realizes P&L, the
 *    excess cannot, and the position is marked incomplete.
 *  - Zero/unknown-price legs are handled without fabricating a value and flag
 *    incompleteness.
 *  - A realizing sell counts as one closed lot: profit → winning, loss → losing.
 */
export function computePosition(input: PnlInput): PositionState {
  const { decimals } = input;
  const events = [...input.events].sort((a, b) => a.timestamp - b.timestamp);

  let totalBoughtRaw = 0n;
  let totalSoldRaw = 0n;
  let transferInRaw = 0n;
  let transferOutRaw = 0n;
  let currentQtyRaw = 0n; // actual running balance
  let trackedQtyRaw = 0n; // purchased inventory carrying cost basis

  let costBasisUsd = 0; // cost of tracked inventory
  let totalInvestedUsd = 0;
  let realizedPnlUsd = 0;
  let avgEntryTimeMs = 0; // qty-weighted entry clock of tracked inventory

  let firstEntryAt: number | null = null;
  let lastTradeAt: number | null = null;
  let winningClosed = 0;
  let losingClosed = 0;
  const holdingSeconds: number[] = [];

  const incompleteReasons = new Set<string>();

  const human = (raw: bigint): number => fromRawAmount(raw.toString(), decimals);

  for (const ev of events) {
    const amt = parseAmount(ev.tokenAmountRaw);
    lastTradeAt = lastTradeAt === null ? ev.timestamp : Math.max(lastTradeAt, ev.timestamp);

    if (ev.kind === 'TRANSFER_IN') {
      transferInRaw += amt;
      currentQtyRaw += amt;
      incompleteReasons.add('transfer_in_untracked_cost');
      continue;
    }
    if (ev.kind === 'TRANSFER_OUT') {
      transferOutRaw += amt;
      currentQtyRaw -= amt;
      continue;
    }

    // SWAP
    if (ev.side === 'BUY') {
      const cost = priceKnown(ev) ? (ev.quoteValueUsd as number) : 0;
      if (!priceKnown(ev)) incompleteReasons.add('zero_price_buy');

      const trackedHumanBefore = human(trackedQtyRaw);
      const buyHuman = human(amt);
      const denom = trackedHumanBefore + buyHuman;
      if (denom > 0) {
        avgEntryTimeMs = (trackedHumanBefore * avgEntryTimeMs + buyHuman * ev.timestamp) / denom;
      }

      totalBoughtRaw += amt;
      currentQtyRaw += amt;
      trackedQtyRaw += amt;
      costBasisUsd += cost;
      totalInvestedUsd += cost;
      firstEntryAt = firstEntryAt === null ? ev.timestamp : Math.min(firstEntryAt, ev.timestamp);
    } else {
      // SELL
      totalSoldRaw += amt;
      currentQtyRaw -= amt;

      const sellHuman = human(amt);
      const trackedHuman = human(trackedQtyRaw);
      const sellableRaw = amt <= trackedQtyRaw ? amt : trackedQtyRaw;
      const sellableHuman = human(sellableRaw);

      if (sellableRaw > 0n && trackedHuman > 0) {
        const costFraction = sellableHuman / trackedHuman;
        const costRemoved = costBasisUsd * costFraction;

        if (priceKnown(ev)) {
          // Proceeds attributable to the tracked portion of this sell.
          const proceedsTracked =
            sellHuman > 0 ? (ev.quoteValueUsd as number) * (sellableHuman / sellHuman) : 0;
          const lotPnl = proceedsTracked - costRemoved;
          realizedPnlUsd += lotPnl;
          if (lotPnl > 0) winningClosed += 1;
          else if (lotPnl < 0) losingClosed += 1;
          holdingSeconds.push(Math.max(0, (ev.timestamp - avgEntryTimeMs) / 1000));
        } else {
          incompleteReasons.add('zero_price_sell');
        }

        trackedQtyRaw -= sellableRaw;
        costBasisUsd -= costRemoved;
        if (costBasisUsd < 0) costBasisUsd = 0;
      }

      if (amt > sellableRaw) {
        // Sold more than we ever purchased → untracked inventory.
        incompleteReasons.add('sell_exceeds_tracked_inventory');
      }
    }
  }

  const currentQtyHuman = human(currentQtyRaw);
  const trackedHuman = human(trackedQtyRaw);
  if (currentQtyRaw < 0n) incompleteReasons.add('negative_balance');

  const avgEntryCostUsd = trackedHuman > 0 ? round(costBasisUsd / trackedHuman, 6) : null;

  const price = input.currentPriceUsd;
  let unrealizedPnlUsd: number | null = null;
  let currentValueUsd: number | null = null;
  if (price !== null && price >= 0) {
    unrealizedPnlUsd = round(trackedHuman * price - costBasisUsd, 2);
    currentValueUsd = round(currentQtyHuman * price, 2);
  } else if (currentQtyRaw !== 0n) {
    incompleteReasons.add('unpriced_open_position');
  }

  const totalReturnUsd =
    unrealizedPnlUsd === null ? null : round(realizedPnlUsd + unrealizedPnlUsd, 2);
  const totalReturnPct =
    totalReturnUsd === null || totalInvestedUsd <= 0
      ? null
      : round((totalReturnUsd / totalInvestedUsd) * 100, 2);

  const avgHoldingPeriodSeconds =
    holdingSeconds.length > 0
      ? round(holdingSeconds.reduce((a, b) => a + b, 0) / holdingSeconds.length, 2)
      : null;

  return {
    totalBoughtRaw,
    totalSoldRaw,
    transferInRaw,
    transferOutRaw,
    currentQtyRaw,
    currentQtyHuman: round(currentQtyHuman, 8),
    avgEntryCostUsd,
    costBasisUsd: round(costBasisUsd, 2),
    totalInvestedUsd: round(totalInvestedUsd, 2),
    realizedPnlUsd: round(realizedPnlUsd, 2),
    unrealizedPnlUsd,
    totalReturnUsd,
    totalReturnPct,
    currentValueUsd,
    firstEntryAt,
    lastTradeAt,
    avgHoldingPeriodSeconds,
    winningClosed,
    losingClosed,
    incomplete: incompleteReasons.size > 0,
    incompleteReasons: [...incompleteReasons],
  };
}

function priceKnown(ev: PnlTradeEvent): boolean {
  return ev.quoteValueUsd !== null && ev.quoteValueUsd > 0;
}

function parseAmount(raw: string): bigint {
  try {
    const v = BigInt(raw);
    return v < 0n ? -v : v;
  } catch {
    return 0n;
  }
}
