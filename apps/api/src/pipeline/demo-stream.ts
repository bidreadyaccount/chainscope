/**
 * Demo streaming service (BUILD_BRIEF §7 — the live demo stream is the same
 * generator emitting new trades on an interval through the same pipeline live
 * mode uses). Consumes `createDemoTradeStream` and feeds each trade to
 * `Pipeline.ingest`, serialized so shared in-memory state mutates one trade at
 * a time. Also publishes periodic `indexer_health` envelopes for the WS/status.
 */

import { createDemoTradeStream, type NormalizedTrade } from '@chainscope/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Pipeline } from './pipeline.js';
import type { PubSub } from '../services/pubsub.js';

export interface DemoStreamDeps {
  readonly pipeline: Pipeline;
  readonly pubsub: PubSub;
  readonly logger: FastifyBaseLogger;
  readonly seed: number;
  readonly intervalMs: number;
  readonly healthIntervalMs?: number;
}

export class DemoStreamService {
  private stopStreamFn?: () => void;
  private healthTimer?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();
  private ingested = 0;
  private lastTradeAt: number | null = null;
  private running = false;

  constructor(private readonly deps: DemoStreamDeps) {}

  isRunning(): boolean {
    return this.running;
  }

  stats(): { running: boolean; ingested: number; lastTradeAt: number | null; intervalMs: number } {
    return {
      running: this.running,
      ingested: this.ingested,
      lastTradeAt: this.lastTradeAt,
      intervalMs: this.deps.intervalMs,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const stream = createDemoTradeStream(this.deps.seed, this.deps.intervalMs);
    this.stopStreamFn = stream.start((trade: NormalizedTrade) => {
      this.queue = this.queue
        .then(() => this.deps.pipeline.ingest(trade))
        .then(() => {
          this.ingested++;
          this.lastTradeAt = trade.blockTimestamp.getTime();
        })
        .catch((err) => this.deps.logger.error({ err }, 'demo-stream: ingest failed'));
    });

    const healthMs = this.deps.healthIntervalMs ?? 10_000;
    this.healthTimer = setInterval(() => {
      void this.deps.pubsub
        .publish('indexer_health', {
          mode: 'demo',
          streamRunning: this.running,
          tradesIngested: this.ingested,
          lastTradeAt: this.lastTradeAt,
        })
        .catch((err) => this.deps.logger.error({ err }, 'demo-stream: health publish failed'));
    }, healthMs);
    if (typeof this.healthTimer.unref === 'function') this.healthTimer.unref();

    this.deps.logger.info(
      { seed: this.deps.seed, intervalMs: this.deps.intervalMs },
      'demo-stream started',
    );
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.stopStreamFn) this.stopStreamFn();
    if (this.healthTimer) clearInterval(this.healthTimer);
    await this.queue.catch(() => undefined);
    this.deps.logger.info('demo-stream stopped');
  }
}
