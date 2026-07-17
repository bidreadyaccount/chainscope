/**
 * Deterministic human formatting for explanation sentences. No locale surprises
 * beyond en-US grouping; every number is stable for snapshot tests.
 */

/** $82,400 style. Negative values render as -$1,200. */
export function formatUsd(value: number, dp = 0): string {
  const abs = Math.abs(value);
  const s = abs.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return `${value < 0 ? '-' : ''}$${s}`;
}

/** 63% style from a fraction (0.63 → "63%"). */
export function formatPct(fraction: number, dp = 0): string {
  return `${(fraction * 100).toFixed(dp)}%`;
}

/** 63% style from an already-percentage number (63 → "63%"). */
export function formatPctPoints(points: number, dp = 0): string {
  return `${points.toFixed(dp)}%`;
}

/** Compact integer with grouping (1,234). */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
