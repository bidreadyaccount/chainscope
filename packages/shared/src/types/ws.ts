/**
 * WebSocket message envelope — BUILD_BRIEF §Interface contracts.
 *   { type, ts, data }
 */

export type WsMessageType = 'trade' | 'token_metrics' | 'score' | 'rankings' | 'indexer_health';

export interface WsEnvelope<T = unknown> {
  readonly type: WsMessageType;
  /** ISO-8601 timestamp the message was produced. */
  readonly ts: string;
  readonly data: T;
}

export function wsEnvelope<T>(type: WsMessageType, data: T, ts: Date = new Date()): WsEnvelope<T> {
  return { type, ts: ts.toISOString(), data };
}
