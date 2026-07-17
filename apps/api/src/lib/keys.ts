/**
 * Redis key + channel conventions (single source of truth — documented in
 * docs/handoff/PHASE_3.md).
 *
 *   Rankings (sorted sets):  cs:rank:{category}:{window}
 *                            member = token address, score = ranking metric
 *   Pub/sub (WS fanout):     cs:ws:{type}   (type = WsMessageType)
 *   Rankings snapshot cache: cs:rank:meta:{category}:{window}  (unused reserve)
 */

import type { TimeWindow } from '@chainscope/config';
import type { WsMessageType } from '@chainscope/shared';
import type { RankingCategory } from '@chainscope/shared';

export const KEY_PREFIX = 'cs';

export function rankingKey(category: RankingCategory, window: TimeWindow): string {
  return `${KEY_PREFIX}:rank:${category}:${window}`;
}

export function wsChannel(type: WsMessageType): string {
  return `${KEY_PREFIX}:ws:${type}`;
}

export const WS_CHANNEL_TYPES: readonly WsMessageType[] = [
  'trade',
  'token_metrics',
  'score',
  'rankings',
  'indexer_health',
];
