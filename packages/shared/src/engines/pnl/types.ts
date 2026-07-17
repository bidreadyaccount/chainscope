/** How a quantity entered/left the wallet. Only SWAP legs affect cost basis. */
export type PnlEventKind = 'SWAP' | 'TRANSFER_IN' | 'TRANSFER_OUT';

/** One chronological position event for a single wallet-token pair. */
export interface PnlTradeEvent {
  readonly side: 'BUY' | 'SELL';
  readonly kind: PnlEventKind;
  /** Raw integer token amount (bigint string), always positive magnitude. */
  readonly tokenAmountRaw: string;
  /** USD value of the swap leg; null/0 = unknown or zero price. */
  readonly quoteValueUsd: number | null;
  /** Event time in epoch milliseconds. */
  readonly timestamp: number;
}

/** Engine input for one wallet-token position. */
export interface PnlInput {
  readonly decimals: number;
  /** Current mark price (USD/token) for unrealized P&L; null = unknown. */
  readonly currentPriceUsd: number | null;
  /** Chronological (or unordered — the engine sorts) position events. */
  readonly events: readonly PnlTradeEvent[];
}

/**
 * Resolved position state. Raw quantities are `bigint` (numeric-safety rule);
 * USD-derived values are `number`. Incompleteness is surfaced, never hidden.
 */
export interface PositionState {
  readonly totalBoughtRaw: bigint;
  readonly totalSoldRaw: bigint;
  readonly transferInRaw: bigint;
  readonly transferOutRaw: bigint;
  readonly currentQtyRaw: bigint;
  readonly currentQtyHuman: number;

  /** Weighted-average entry cost (USD/token) of tracked inventory; null if none. */
  readonly avgEntryCostUsd: number | null;
  /** Remaining tracked cost basis (USD). */
  readonly costBasisUsd: number;
  /** Total USD ever deployed via swap buys. */
  readonly totalInvestedUsd: number;

  readonly realizedPnlUsd: number;
  /** Unrealized P&L on tracked inventory; null when price unknown. */
  readonly unrealizedPnlUsd: number | null;
  readonly totalReturnUsd: number | null;
  readonly totalReturnPct: number | null;
  readonly currentValueUsd: number | null;

  readonly firstEntryAt: number | null;
  readonly lastTradeAt: number | null;
  readonly avgHoldingPeriodSeconds: number | null;

  readonly winningClosed: number;
  readonly losingClosed: number;

  readonly incomplete: boolean;
  readonly incompleteReasons: readonly string[];
}
