/**
 * Live rankings backed by Redis sorted sets (SPEC §13 — all 12 ranking types,
 * window-selectable). One sorted set per (category, window); member = token
 * address, score = the category's ranking metric. Highest-first reads via
 * ZREVRANGE. Historical snapshots live in Postgres (TokenScoreSnapshot).
 */

import { TIME_WINDOWS, type TimeWindow } from '@chainscope/config';
import type { TokenMetrics, ScoreResult, RankingCategory } from '@chainscope/shared';
import type { RedisClient } from '../lib/redis.js';
import { rankingKey } from '../lib/keys.js';

export const RANKING_CATEGORIES: readonly RankingCategory[] = [
  'opportunity',
  'smart_money_buying',
  'whale_accumulation',
  'whale_selling',
  'retail_momentum',
  'new_wallet_surge',
  'unusual_volume',
  'liquidity_growth',
  'deployer_selling',
  'coordinated_wallets',
  'strongest_distribution',
  'highest_risk',
];

/**
 * Map a token's computed metrics+score to the sorted-set score for each ranking
 * category. Sorted sets are read highest-first, so each value is oriented so
 * that "more of the named phenomenon" ranks higher.
 */
export function rankingValue(
  category: RankingCategory,
  metrics: TokenMetrics,
  score: ScoreResult,
): number {
  switch (category) {
    case 'opportunity':
      return score.score;
    case 'smart_money_buying':
      return metrics.smartMoneyNetFlowUsd;
    case 'whale_accumulation':
      return metrics.whaleNetFlowUsd;
    case 'whale_selling':
      return -metrics.whaleNetFlowUsd;
    case 'retail_momentum':
      return metrics.retailNetFlowUsd;
    case 'new_wallet_surge':
      return metrics.newWalletNetFlowUsd;
    case 'unusual_volume':
      return metrics.buyVolumeUsd + metrics.sellVolumeUsd;
    case 'liquidity_growth':
      return metrics.liquidityChangePct ?? 0;
    case 'deployer_selling':
      return -metrics.deployerLinkedNetFlowUsd;
    case 'coordinated_wallets':
      return metrics.buyerConcentration;
    case 'strongest_distribution':
      return -metrics.netFlowUsd;
    case 'highest_risk':
      return score.riskScore;
  }
}

export interface RankingEntry {
  readonly address: string;
  readonly value: number;
  readonly rank: number;
}

export interface TokenRankingInput {
  readonly address: string;
  readonly metrics: TokenMetrics;
  readonly score: ScoreResult;
}

export class RankingsService {
  constructor(private readonly redis: RedisClient) {}

  /** Update every category sorted set for a window from the given tokens. */
  async updateWindow(window: TimeWindow, tokens: readonly TokenRankingInput[]): Promise<void> {
    if (tokens.length === 0) return;
    const pipe = this.redis.pipeline();
    for (const category of RANKING_CATEGORIES) {
      const key = rankingKey(category, window);
      for (const t of tokens) {
        pipe.zadd(key, rankingValue(category, t.metrics, t.score), t.address);
      }
    }
    await pipe.exec();
  }

  /** Update all windows in one batch (used on full rebuild). */
  async updateAll(perWindow: Record<TimeWindow, readonly TokenRankingInput[]>): Promise<void> {
    for (const window of TIME_WINDOWS) {
      await this.updateWindow(window, perWindow[window]);
    }
  }

  /** Update every (category, window) sorted set for a single token in one pipeline. */
  async updateToken(
    address: string,
    viewsByWindow: Partial<Record<TimeWindow, { metrics: TokenMetrics; score: ScoreResult }>>,
  ): Promise<void> {
    const pipe = this.redis.pipeline();
    let any = false;
    for (const window of TIME_WINDOWS) {
      const view = viewsByWindow[window];
      if (!view) continue;
      any = true;
      for (const category of RANKING_CATEGORIES) {
        pipe.zadd(rankingKey(category, window), rankingValue(category, view.metrics, view.score), address);
      }
    }
    if (any) await pipe.exec();
  }

  async read(category: RankingCategory, window: TimeWindow, limit: number): Promise<RankingEntry[]> {
    const key = rankingKey(category, window);
    const raw = await this.redis.zrevrange(key, 0, Math.max(0, limit - 1), 'WITHSCORES');
    const entries: RankingEntry[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const address = raw[i];
      const scoreStr = raw[i + 1];
      if (address === undefined || scoreStr === undefined) continue;
      entries.push({ address, value: Number(scoreStr), rank: entries.length + 1 });
    }
    return entries;
  }

  /** Remove all ranking sorted sets (test/reset hygiene). */
  async clear(): Promise<void> {
    const keys: string[] = [];
    for (const category of RANKING_CATEGORIES) {
      for (const window of TIME_WINDOWS) keys.push(rankingKey(category, window));
    }
    if (keys.length > 0) await this.redis.del(...keys);
  }
}
