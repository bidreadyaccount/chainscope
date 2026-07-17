export * from './common.js';
export * from './trade.js';
export * from './wallet.js';
export * from './ws.js';

// Re-export the time-window types from config so consumers can import them from
// a single place (BUILD_BRIEF: time-window types belong in shared's surface).
export {
  TIME_WINDOWS,
  TIME_WINDOW_MS,
  TIME_WINDOW_LABEL,
  DEFAULT_TIME_WINDOW,
  isTimeWindow,
  timeWindowMs,
  type TimeWindow,
} from '@chainscope/config';
