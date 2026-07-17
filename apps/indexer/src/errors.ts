/**
 * IndexerError recorder (SPEC §6). Persists indexer failures with context to the
 * `IndexerError` table so operators can diagnose what went wrong at which block
 * without tailing logs. Best-effort: a failure to record must never crash the
 * indexer, so write errors are swallowed after logging.
 */

import type { PrismaClient } from '@chainscope/database';
import type { Hex } from '@chainscope/shared';

export type IndexerErrorSeverity = 'info' | 'warn' | 'error' | 'fatal';

export interface RecordErrorInput {
  readonly context: string;
  readonly message: string;
  readonly blockNumber?: bigint | null;
  readonly txHash?: Hex | null;
  readonly severity?: IndexerErrorSeverity;
}

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

export class IndexerErrorRecorder {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chainId: number,
    private readonly logger: Logger,
  ) {}

  async record(input: RecordErrorInput): Promise<void> {
    const severity = input.severity ?? 'error';
    this.logger[severity === 'fatal' ? 'error' : severity === 'info' ? 'info' : severity](
      { context: input.context, blockNumber: input.blockNumber?.toString(), txHash: input.txHash },
      `indexer: ${input.message}`,
    );
    try {
      await this.prisma.indexerError.create({
        data: {
          chainId: this.chainId,
          context: input.context,
          message: input.message.slice(0, 2_000),
          blockNumber: input.blockNumber ?? null,
          txHash: input.txHash ?? null,
          severity,
        },
      });
    } catch (err) {
      // Never let error-recording sink the loop.
      this.logger.error({ err }, 'indexer: failed to persist IndexerError');
    }
  }
}
