/**
 * Trade-planner types. The planner turns a desired basket (target weights) plus a
 * user's current wallet into an abstract list of buy/sell swaps. It works in USD
 * and token quantities only — it never sees or emits a contract address. The
 * on-chain router maps `stockTokenId` → a real, operator-configured address at
 * execution time. Weights are integer basis points summing to 10000, matching the
 * index engine.
 */

/** What the user is trying to do with a basket. */
export type TradeAction = 'BUY' | 'SELL' | 'REBALANCE';

/** One side of a single swap. (Named `SwapSide` to avoid clashing with the
 * package-level `TradeSide` used for classified on-chain swaps.) */
export type SwapSide = 'BUY' | 'SELL';

/** A current wallet holding of one stock-token (quantity in token units). */
export interface Holding {
  readonly stockTokenId: string;
  readonly ticker: string;
  /** Token units currently held. Must be finite and >= 0. */
  readonly qty: number;
}

/** A target weight for one name in the desired basket. */
export interface TargetWeight {
  readonly stockTokenId: string;
  readonly ticker: string;
  /** Integer basis points; the target set is expected to sum to ~10000. */
  readonly weightBps: number;
}

/** Why a name could not be traded and was surfaced instead of silently dropped. */
export type PlanExclusionReason =
  | 'NO_PRICE' // no price supplied for this token
  | 'NON_FINITE_PRICE'; // price present but NaN / ±Infinity / <= 0

/** A name excluded from the plan, with a machine-readable reason. */
export interface ExcludedName {
  readonly stockTokenId: string;
  readonly ticker: string;
  readonly reason: PlanExclusionReason;
}

/**
 * One planned swap. `minReceived` is the slippage-protected floor the on-chain
 * router should enforce, and its unit depends on the side:
 *   - BUY:  minimum **token units** to receive for `amountUsd` of stablecoin.
 *   - SELL: minimum **USD** (stablecoin) to receive for `estQty` tokens.
 */
export interface PlannedTrade {
  readonly stockTokenId: string;
  readonly ticker: string;
  readonly side: SwapSide;
  /** Notional USD traded. Always finite and > 0. */
  readonly amountUsd: number;
  /** Estimated token units at the reference price (amountUsd / priceUsd). */
  readonly estQty: number;
  /** Reference USD price per token used for the estimate. */
  readonly priceUsd: number;
  /** Slippage-protected floor; unit depends on `side` (see interface docs). */
  readonly minReceived: number;
}

/** Index-level failure reason when no actionable plan could be produced. */
export type PlanError =
  | 'INVALID_INPUT' // missing/negative cash where required, bad targets, etc.
  | 'NO_PRICED_TARGETS' // every target name lacks a usable price
  | 'NOTHING_TO_TRADE'; // no holdings to sell (SELL) — an empty action

/** Per-name target dollar figure after apportionment (transparency / tests). */
export interface TargetUsd {
  readonly stockTokenId: string;
  readonly ticker: string;
  readonly usd: number;
}

/** The result of planning a basket action. */
export interface TradePlan {
  readonly action: TradeAction;
  /** True when an actionable (possibly empty, if already balanced) plan exists. */
  readonly ok: boolean;
  /** Present only when ok is false. */
  readonly error?: PlanError;
  /** Set on ok:true when no trades were needed (e.g. REBALANCE already in band). */
  readonly note?: 'ALREADY_BALANCED';
  readonly trades: PlannedTrade[];
  /** Sum of BUY amountUsd. */
  readonly grossBuyUsd: number;
  /** Sum of SELL amountUsd. */
  readonly grossSellUsd: number;
  /** grossBuyUsd − grossSellUsd: cash the user must add (+) or receives (−). */
  readonly netCashUsd: number;
  /** Portfolio USD value the plan targets (post-trade invested value). */
  readonly investedUsd: number;
  readonly targetUsd: TargetUsd[];
  readonly excluded: ExcludedName[];
  /** Slippage tolerance applied to every trade's minReceived, in bps. */
  readonly slippageBps: number;
}

/** Inputs to `planTrades`. */
export interface PlanInput {
  readonly action: TradeAction;
  /** Current wallet. May be empty (e.g. a first BUY). */
  readonly holdings: readonly Holding[];
  /** Desired basket weights (bps ~ 10000). Ignored for SELL. */
  readonly targets: readonly TargetWeight[];
  /** USD price per token, keyed by stockTokenId. Missing key ⇒ NO_PRICE. */
  readonly prices: Readonly<Record<string, number>>;
  /** Cash (USD) to invest on BUY, or to add on REBALANCE. Ignored for SELL. */
  readonly cashUsd?: number;
  /** Slippage tolerance in bps (default 50 = 0.5%). */
  readonly slippageBps?: number;
  /**
   * Rebalance no-trade band, in bps of the portfolio (default 50 = 0.5%). A
   * per-name target/current gap smaller than this is left alone to avoid churn.
   */
  readonly rebalanceBandBps?: number;
  /** Trades below this USD value are treated as dust and dropped (default 0.01). */
  readonly dustUsd?: number;
}
