/**
 * Wallet classification types — SPEC §7 verbatim union.
 */

export type WalletClass =
  | 'MEGA_WHALE'
  | 'WHALE'
  | 'LARGE_TRADER'
  | 'SMART_MONEY'
  | 'RETAIL'
  | 'NEW_WALLET'
  | 'BOT'
  | 'DEPLOYER_LINKED'
  | 'MARKET_MAKER'
  | 'PROTOCOL'
  | 'UNKNOWN';

export const WALLET_CLASSES: readonly WalletClass[] = [
  'MEGA_WHALE',
  'WHALE',
  'LARGE_TRADER',
  'SMART_MONEY',
  'RETAIL',
  'NEW_WALLET',
  'BOT',
  'DEPLOYER_LINKED',
  'MARKET_MAKER',
  'PROTOCOL',
  'UNKNOWN',
];

export function isWalletClass(value: unknown): value is WalletClass {
  return typeof value === 'string' && (WALLET_CLASSES as readonly string[]).includes(value);
}

/**
 * A single hedged label attached to a wallet (a wallet may carry several).
 * Wording stays non-accusatory per BUILD_BRIEF guardrails.
 */
export interface WalletLabelInfo {
  readonly class: WalletClass;
  /** 0–100 */
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly supportingMetrics?: Record<string, number | string>;
  readonly lastCalculatedAt: string;
}

/**
 * Resolved classification with an explicit primary class (precedence applied)
 * and the full set of labels that matched.
 */
export interface WalletClassification {
  readonly primary: WalletClass;
  /** 0–100 confidence in the primary classification. */
  readonly confidence: number;
  readonly labels: readonly WalletLabelInfo[];
}
