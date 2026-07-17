/**
 * RPC retry with exponential backoff + full jitter (SPEC §19). The delay
 * computation is a pure function so backoff bounds are unit-testable; the retry
 * loop takes an injectable `sleep` + `random` so it can be driven under fake
 * timers deterministically.
 */

export interface BackoffOptions {
  /** Base delay in ms (default 200). */
  readonly baseMs: number;
  /** Maximum delay cap in ms (default 8000). */
  readonly maxMs: number;
}

/**
 * Full-jitter backoff: delay = random(0, min(maxMs, base * 2^attempt)).
 * `attempt` is 0-based (0 = first retry). `random` returns [0,1).
 */
export function computeBackoffDelay(
  attempt: number,
  opts: BackoffOptions,
  random: () => number = Math.random,
): number {
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * exp);
}

export interface RetryOptions extends Partial<BackoffOptions> {
  /** Number of retries after the first attempt (default 4). */
  readonly retries?: number;
  /** Predicate: should this error be retried? Default: always. */
  readonly shouldRetry?: (err: unknown) => boolean;
  readonly onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying on failure with jittered exponential backoff. Re-throws the
 * last error once retries are exhausted (or the predicate rejects the error).
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 4;
  const baseMs = options.baseMs ?? 200;
  const maxMs = options.maxMs ?? 8_000;
  const shouldRetry = options.shouldRetry ?? (() => true);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) break;
      const delay = computeBackoffDelay(attempt, { baseMs, maxMs }, random);
      options.onRetry?.(attempt, delay, err);
      await sleep(delay);
    }
  }
  throw lastErr;
}
