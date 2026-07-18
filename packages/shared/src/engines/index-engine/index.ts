/**
 * Index engine — pure, deterministic, I/O-free functions for weight
 * construction and index valuation. Methodology parameters come from
 * `@chainscope/config`; nothing here touches the DB, network or clock.
 */
export * from './types.js';
export { computeWeights, buildManualWeights, type ManualWeightInput } from './weights.js';
export {
  buildBasket,
  computeLevel,
  simulateInvestment,
  computeSectorAllocation,
  computeConcentration,
  computeTurnoverBps,
  computePerformance,
} from './valuation.js';
