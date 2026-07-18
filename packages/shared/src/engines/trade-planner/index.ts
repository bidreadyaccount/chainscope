/**
 * Trade planner — pure, deterministic, I/O-free planning of buy/sell/rebalance
 * swaps for the buyable "Basket Router" layer. Emits an abstract, address-free
 * plan; the on-chain router maps token IDs → operator-configured addresses.
 * See docs/handoff/BASKET_ROUTER.md.
 */
export * from './types.js';
export {
  planTrades,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_REBALANCE_BAND_BPS,
  DEFAULT_DUST_USD,
} from './plan.js';
