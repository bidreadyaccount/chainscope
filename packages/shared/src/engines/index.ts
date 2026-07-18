/**
 * ChainScope analytics engines — pure, I/O-free functions (BUILD_BRIEF §6).
 * All thresholds/weights are imported from `@chainscope/config`; nothing here
 * touches the DB, network, or clock (callers pass `now` where needed).
 */
export * from './math.js';
export * from './classification/index.js';
export * from './pnl/index.js';
export * from './metrics/index.js';
export * from './scoring/index.js';
export * from './explanations/index.js';
export * from './index-engine/index.js';
export * from './trade-planner/index.js';
