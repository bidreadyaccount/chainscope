/**
 * Rolling time-window definitions used across metrics, rankings and the API.
 * Per SPEC §10: 1m, 5m, 15m, 1h, 4h, 24h.
 */

export const TIME_WINDOWS = ['1m', '5m', '15m', '1h', '4h', '24h'] as const;

export type TimeWindow = (typeof TIME_WINDOWS)[number];

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Milliseconds represented by each window key. */
export const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  '1m': 1 * MINUTE,
  '5m': 5 * MINUTE,
  '15m': 15 * MINUTE,
  '1h': 1 * HOUR,
  '4h': 4 * HOUR,
  '24h': 24 * HOUR,
};

/** Human-readable labels for UI display. */
export const TIME_WINDOW_LABEL: Record<TimeWindow, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '4h': '4 hours',
  '24h': '24 hours',
};

export const DEFAULT_TIME_WINDOW: TimeWindow = '1h';

export function isTimeWindow(value: unknown): value is TimeWindow {
  return typeof value === 'string' && (TIME_WINDOWS as readonly string[]).includes(value);
}

export function timeWindowMs(window: TimeWindow): number {
  return TIME_WINDOW_MS[window];
}
