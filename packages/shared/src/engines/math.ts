/**
 * Pure numeric helpers shared across engines. No I/O, fully deterministic.
 *
 * All normalization here is explicit and bounded — no magic constants live in
 * this file; scales are supplied by callers (engines pass them from
 * `@chainscope/config`). These helpers only implement the math.
 */

/** Clamp `v` into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/** Clamp into [0, 1]. */
export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/**
 * Map a signed value to [0, 1] via 0.5 + 0.5*tanh(v/scale). A zero input maps
 * to the neutral 0.5; large positive/negative magnitudes saturate toward 1/0.
 * Deterministic and monotonic. `scale` must be > 0.
 */
export function tanhNormalize(value: number, scale: number): number {
  if (!Number.isFinite(value) || scale <= 0) return 0.5;
  return clamp01(0.5 + 0.5 * Math.tanh(value / scale));
}

/**
 * Map a non-negative count to [0, 1] via a log curve that reaches ~1 near
 * `target`. Used for sample-size / trade-count confidence. `target` must be > 0.
 */
export function logCountConfidence(count: number, target: number): number {
  if (count <= 0 || target <= 0) return 0;
  return clamp01(Math.log1p(count) / Math.log1p(target));
}

/** Arithmetic mean; empty input → 0. */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Numerically correct median (average of the two middle values for even n). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Top-N concentration: the share (0..1) of `total` held by the N largest of
 * `values`. Returns 0 when `total` is 0. Values are treated as non-negative
 * contributions; negatives are floored to 0.
 */
export function topNShare(values: readonly number[], n: number, total?: number): number {
  const positive = values.map((v) => Math.max(0, v));
  const sum = total ?? positive.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;
  const topSum = [...positive]
    .sort((a, b) => b - a)
    .slice(0, Math.max(0, n))
    .reduce((a, b) => a + b, 0);
  return clamp01(topSum / sum);
}

/** Round to `dp` decimal places (default 2) for stable snapshots. */
export function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
