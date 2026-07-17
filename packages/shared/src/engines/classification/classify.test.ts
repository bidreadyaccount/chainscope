import { describe, it, expect } from 'vitest';
import { WALLET_THRESHOLDS, WALLET_CLASS_PRECEDENCE } from '@chainscope/config';
import { classifyWallet } from './classify.js';
import type { WalletActivitySummary } from './types.js';

const NOW = Date.UTC(2025, 0, 1, 0, 0, 0);

function base(overrides: Partial<WalletActivitySummary> = {}): WalletActivitySummary {
  return {
    address: '0xabc',
    portfolioValueUsd: 5_000,
    tradeSizesUsd: [200, 300, 250],
    firstSeenDaysAgo: 400,
    txCount: 200,
    ...overrides,
  };
}

const classesOf = (r: ReturnType<typeof classifyWallet>) => r.labels.map((l) => l.class);

describe('classifyWallet — whale threshold boundaries (SPEC §8)', () => {
  it('portfolio exactly $1,000,000 → MEGA_WHALE (>= boundary)', () => {
    const r = classifyWallet(base({ portfolioValueUsd: WALLET_THRESHOLDS.megaWhale.portfolioUsd }), NOW);
    expect(classesOf(r)).toContain('MEGA_WHALE');
    expect(r.primary).toBe('MEGA_WHALE');
  });

  it('portfolio $999,999.99 → not MEGA_WHALE but still WHALE (>= $250k)', () => {
    const r = classifyWallet(base({ portfolioValueUsd: 999_999.99 }), NOW);
    expect(classesOf(r)).not.toContain('MEGA_WHALE');
    expect(classesOf(r)).toContain('WHALE');
    expect(r.primary).toBe('WHALE');
  });

  it('portfolio exactly $250,000 → WHALE (>= boundary)', () => {
    const r = classifyWallet(base({ portfolioValueUsd: WALLET_THRESHOLDS.whale.portfolioUsd }), NOW);
    expect(classesOf(r)).toContain('WHALE');
  });

  it('portfolio $249,999.99 → not WHALE', () => {
    const r = classifyWallet(base({ portfolioValueUsd: 249_999.99, firstSeenDaysAgo: 400 }), NOW);
    expect(classesOf(r)).not.toContain('WHALE');
    // still qualifies as LARGE_TRADER (>= $50k)
    expect(classesOf(r)).toContain('LARGE_TRADER');
  });

  it('single trade exactly $100,000 → MEGA_WHALE via single-trade rule', () => {
    const r = classifyWallet(
      base({ portfolioValueUsd: 5_000, tradeSizesUsd: [100_000] }),
      NOW,
    );
    expect(classesOf(r)).toContain('MEGA_WHALE');
  });

  it('single trade exactly $25,000 → WHALE via single-trade rule', () => {
    const r = classifyWallet(base({ portfolioValueUsd: 5_000, tradeSizesUsd: [25_000] }), NOW);
    expect(classesOf(r)).toContain('WHALE');
    expect(classesOf(r)).not.toContain('MEGA_WHALE');
  });

  it('supply control exactly 2% → MEGA_WHALE; exactly 1% → WHALE only', () => {
    const mega = classifyWallet(base({ maxSupplyControlFraction: 0.02 }), NOW);
    expect(classesOf(mega)).toContain('MEGA_WHALE');
    const whale = classifyWallet(base({ maxSupplyControlFraction: 0.01 }), NOW);
    expect(classesOf(whale)).toContain('WHALE');
    expect(classesOf(whale)).not.toContain('MEGA_WHALE');
  });
});

describe('classifyWallet — large trader / retail / new wallet boundaries', () => {
  it('typical trade exactly $5,000 → LARGE_TRADER', () => {
    const r = classifyWallet(
      base({ portfolioValueUsd: 8_000, tradeSizesUsd: [5_000, 5_000, 5_000] }),
      NOW,
    );
    expect(classesOf(r)).toContain('LARGE_TRADER');
  });

  it('portfolio exactly $50,000 → LARGE_TRADER via portfolio rule', () => {
    const r = classifyWallet(base({ portfolioValueUsd: 50_000, tradeSizesUsd: [100] }), NOW);
    expect(classesOf(r)).toContain('LARGE_TRADER');
  });

  it('portfolio < $10k and typical trade < $1k → RETAIL', () => {
    const r = classifyWallet(
      base({ portfolioValueUsd: 9_999, tradeSizesUsd: [100, 200, 300], firstSeenDaysAgo: 400, txCount: 50 }),
      NOW,
    );
    expect(classesOf(r)).toContain('RETAIL');
    expect(r.primary).toBe('RETAIL');
  });

  it('portfolio exactly $10,000 → NOT retail (boundary is strictly below)', () => {
    const r = classifyWallet(
      base({ portfolioValueUsd: 10_000, tradeSizesUsd: [100], firstSeenDaysAgo: 400, txCount: 50 }),
      NOW,
    );
    expect(classesOf(r)).not.toContain('RETAIL');
  });

  it('first seen exactly 7 days ago → NEW_WALLET (<= boundary)', () => {
    const r = classifyWallet(base({ firstSeenDaysAgo: 7, txCount: 100 }), NOW);
    expect(classesOf(r)).toContain('NEW_WALLET');
  });

  it('first seen 7.01 days ago with 100 txs → NOT new', () => {
    const r = classifyWallet(base({ firstSeenDaysAgo: 7.01, txCount: 100 }), NOW);
    expect(classesOf(r)).not.toContain('NEW_WALLET');
  });

  it('fewer than 5 lifetime txs → NEW_WALLET regardless of age', () => {
    const r = classifyWallet(base({ firstSeenDaysAgo: 400, txCount: 4 }), NOW);
    expect(classesOf(r)).toContain('NEW_WALLET');
  });

  it('exactly 5 lifetime txs and old → NOT new via tx-count rule', () => {
    const r = classifyWallet(base({ firstSeenDaysAgo: 400, txCount: 5 }), NOW);
    expect(classesOf(r)).not.toContain('NEW_WALLET');
  });
});

describe('classifyWallet — precedence (SPEC §7)', () => {
  it('a whale-sized bot resolves primary to BOT (bot outranks whale)', () => {
    const r = classifyWallet(
      base({
        portfolioValueUsd: 2_000_000,
        timing: {
          boughtInLaunchBlock: true,
          minReactionTimeMs: 500,
          identicalAmountRepeats: 8,
          txPerHourPeak: 60,
        },
      }),
      NOW,
    );
    expect(classesOf(r)).toEqual(expect.arrayContaining(['BOT', 'MEGA_WHALE']));
    expect(r.primary).toBe('BOT');
  });

  it('protocol flag outranks everything', () => {
    const r = classifyWallet(base({ isKnownProtocol: true, portfolioValueUsd: 2_000_000 }), NOW);
    expect(r.primary).toBe('PROTOCOL');
  });

  it('market maker outranks whale but not protocol', () => {
    const r = classifyWallet(base({ isKnownMarketMaker: true, portfolioValueUsd: 2_000_000 }), NOW);
    expect(r.primary).toBe('MARKET_MAKER');
  });

  it('deployer-linked outranks whale', () => {
    const r = classifyWallet(
      base({ portfolioValueUsd: 300_000, isFundedByDeployer: true, interactedBeforePublicTrading: true }),
      NOW,
    );
    expect(classesOf(r)).toEqual(expect.arrayContaining(['DEPLOYER_LINKED', 'WHALE']));
    expect(r.primary).toBe('DEPLOYER_LINKED');
  });

  it('labels are ordered by precedence and primary is the first', () => {
    const r = classifyWallet(
      base({
        portfolioValueUsd: 2_000_000,
        isFundedByDeployer: true,
        interactedBeforePublicTrading: true,
      }),
      NOW,
    );
    const ranks = r.labels.map((l) => WALLET_CLASS_PRECEDENCE.indexOf(l.class));
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
    expect(r.primary).toBe(r.labels[0]!.class);
  });

  it('no matching label → UNKNOWN', () => {
    // Old, established, mid portfolio between retail and large-trader gates.
    const r = classifyWallet(
      base({ portfolioValueUsd: 20_000, tradeSizesUsd: [1_500, 1_500], firstSeenDaysAgo: 400, txCount: 200 }),
      NOW,
    );
    expect(r.primary).toBe('UNKNOWN');
    expect(r.labels).toHaveLength(1);
  });
});

describe('classifyWallet — output shape', () => {
  it('every label carries confidence 0..100, reasons and a timestamp', () => {
    const r = classifyWallet(base({ portfolioValueUsd: 300_000 }), NOW);
    for (const l of r.labels) {
      expect(l.confidence).toBeGreaterThanOrEqual(0);
      expect(l.confidence).toBeLessThanOrEqual(100);
      expect(l.reasons.length).toBeGreaterThan(0);
      expect(l.lastCalculatedAt).toBe(new Date(NOW).toISOString());
    }
  });

  it('is deterministic for identical input', () => {
    const w = base({ portfolioValueUsd: 300_000 });
    expect(classifyWallet(w, NOW)).toEqual(classifyWallet(w, NOW));
  });
});
