/**
 * Minimal circuit breaker for RPC calls (SPEC §19 — provider-failure handling).
 *
 * States:
 *   closed     — requests flow; consecutive failures are counted.
 *   open       — requests are rejected fast until the cooldown elapses.
 *   half_open  — a single probe request is allowed; success closes the breaker,
 *                failure re-opens it.
 *
 * The breaker is a pure state machine (clock injected) so transitions are unit
 * testable without real time. The provider consults `canRequest()` before each
 * call and reports `record{Success,Failure}()` after.
 */

import type { CircuitStateName } from './types.js';

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker open (default 5). */
  readonly failureThreshold: number;
  /** Cooldown before a half-open probe is permitted, ms (default 15s). */
  readonly cooldownMs: number;
  /** Clock injection for tests. */
  readonly now?: () => number;
}

export interface CircuitSnapshot {
  readonly state: CircuitStateName;
  readonly consecutiveFailures: number;
  readonly openedAt: number | null;
}

export class CircuitBreaker {
  private state: CircuitStateName = 'closed';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private probing = false;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: CircuitBreakerOptions) {
    this.failureThreshold = Math.max(1, opts.failureThreshold);
    this.cooldownMs = Math.max(0, opts.cooldownMs);
    this.now = opts.now ?? Date.now;
  }

  /**
   * Whether a request may proceed. Side-effect: when the cooldown has elapsed an
   * open breaker transitions to half-open and admits exactly one probe.
   */
  canRequest(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (this.openedAt !== null && this.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'half_open';
        this.probing = false;
      } else {
        return false;
      }
    }
    // half_open: admit a single probe at a time.
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
    this.openedAt = null;
    this.probing = false;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    this.probing = false;
    if (this.state === 'half_open' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  snapshot(): CircuitSnapshot {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
    };
  }
}

/** Thrown when a call is short-circuited by an open breaker. */
export class CircuitOpenError extends Error {
  constructor() {
    super('circuit breaker is open');
    this.name = 'CircuitOpenError';
  }
}
