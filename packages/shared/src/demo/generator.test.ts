import { describe, it, expect } from 'vitest';
import { generateDemoDataset } from './generator.js';
import { createDemoTradeStream } from './stream.js';
import { DEMO_SCENARIOS } from './types.js';
import { serializedTradeSchema } from '../schemas/trade.js';
import { serializeForWire } from '../utils/bigint.js';

const FIXED_NOW = Date.UTC(2025, 5, 15, 12, 0, 0);

describe('demo dataset generation', () => {
  const ds = generateDemoDataset(1337, FIXED_NOW);

  it('produces the required population sizes', () => {
    expect(ds.tokens.length).toBe(30);
    expect(ds.wallets.length).toBe(250);
    expect(ds.trades.length).toBeGreaterThanOrEqual(5000);
  });

  it('is fully deterministic for the same seed and clock', () => {
    const a = generateDemoDataset(1337, FIXED_NOW);
    const b = generateDemoDataset(1337, FIXED_NOW);
    expect(a.trades.length).toBe(b.trades.length);
    // Deep structural equality including bigint/Date fields.
    expect(serializeForWire(a.trades)).toEqual(serializeForWire(b.trades));
    expect(a.tokens).toEqual(b.tokens);
    expect(a.wallets).toEqual(b.wallets);
  });

  it('changes output for a different seed', () => {
    const other = generateDemoDataset(9999, FIXED_NOW);
    expect(serializeForWire(other.trades)).not.toEqual(serializeForWire(ds.trades));
  });

  it('includes 6, 8 and 18 decimal tokens', () => {
    const decimals = new Set(ds.tokens.map((t) => t.decimals));
    expect(decimals.has(6)).toBe(true);
    expect(decimals.has(8)).toBe(true);
    expect(decimals.has(18)).toBe(true);
  });

  it('has exactly one deliberately unpriced token', () => {
    const unpriced = ds.tokens.filter((t) => t.priceUsd === null);
    expect(unpriced.length).toBe(1);
    expect(unpriced[0]!.priceConfidence).toBe(0);
    // Its trades carry null valueUsd => "insufficient pricing data".
    const unTrades = ds.trades.filter((t) => t.tokenAddress === unpriced[0]!.address);
    expect(unTrades.length).toBeGreaterThan(0);
    expect(unTrades.every((t) => t.valueUsd === null && t.priceUsd === null)).toBe(true);
  });

  it('represents every named scenario with trades', () => {
    for (const s of DEMO_SCENARIOS) {
      expect(ds.scenarioCounts[s]).toBeGreaterThan(0);
    }
  });

  it('emits well-formed wallet-class coverage including whales, smart money and bots', () => {
    const classes = new Set(ds.trades.map((t) => t.walletClass));
    for (const c of [
      'MEGA_WHALE',
      'WHALE',
      'SMART_MONEY',
      'RETAIL',
      'NEW_WALLET',
      'BOT',
      'DEPLOYER_LINKED',
    ]) {
      expect(classes.has(c as never)).toBe(true);
    }
  });

  it('bots produce rapid identical-size trades', () => {
    const bySizeByBot = new Map<string, Map<number, number>>();
    for (const t of ds.trades) {
      if (t.walletClass !== 'BOT' || t.valueUsd === null) continue;
      const m = bySizeByBot.get(t.traderAddress) ?? new Map<number, number>();
      m.set(t.valueUsd, (m.get(t.valueUsd) ?? 0) + 1);
      bySizeByBot.set(t.traderAddress, m);
    }
    const maxIdentical = [...bySizeByBot.values()].flatMap((m) => [...m.values()]);
    expect(Math.max(...maxIdentical)).toBeGreaterThanOrEqual(15);
  });

  it('every trade is a valid NormalizedTrade and demo-flagged', () => {
    for (const t of ds.trades) {
      expect(t.isDemo).toBe(true);
      expect(t.chainId).toBe(4663);
      expect(t.transactionHash.startsWith('0xDEMO')).toBe(true);
      expect(/^\d+$/.test(t.tokenAmount)).toBe(true);
      expect(/^\d+$/.test(t.quoteAmount)).toBe(true);
      expect(typeof t.blockNumber).toBe('bigint');
    }
    // Schema-validate the wire form of a representative sample.
    const sample = ds.trades.slice(0, 300);
    for (const t of sample) {
      const res = serializedTradeSchema.safeParse(serializeForWire(t));
      expect(res.success, JSON.stringify(res.success ? {} : res.error.issues)).toBe(true);
    }
  });

  it('produces unique (chainId, txHash, logIndex) tuples', () => {
    const keys = new Set(ds.trades.map((t) => `${t.chainId}:${t.transactionHash}:${t.logIndex}`));
    expect(keys.size).toBe(ds.trades.length);
  });

  it('has trades within the trailing 24h window', () => {
    const oldest = Math.min(...ds.trades.map((t) => t.blockTimestamp.getTime()));
    const newest = Math.max(...ds.trades.map((t) => t.blockTimestamp.getTime()));
    expect(newest).toBeLessThanOrEqual(FIXED_NOW);
    expect(oldest).toBeGreaterThanOrEqual(FIXED_NOW - 24 * 60 * 60 * 1000);
  });
});

describe('demo trade stream', () => {
  it('is deterministic for the same seed and timestamps', () => {
    const at = new Date(FIXED_NOW);
    const s1 = createDemoTradeStream(1337, 1000);
    const s2 = createDemoTradeStream(1337, 1000);
    const a = Array.from({ length: 50 }, () => s1.next(at));
    const b = Array.from({ length: 50 }, () => s2.next(at));
    expect(serializeForWire(a)).toEqual(serializeForWire(b));
  });

  it('emits valid demo trades with non-colliding stream hashes', () => {
    const s = createDemoTradeStream(1337, 1000);
    const ds = generateDemoDataset(1337, FIXED_NOW);
    const histHashes = new Set(ds.trades.map((t) => t.transactionHash));
    const at = new Date(FIXED_NOW);
    for (let i = 0; i < 100; i++) {
      const t = s.next(at);
      expect(t.isDemo).toBe(true);
      expect(histHashes.has(t.transactionHash)).toBe(false);
      expect(serializedTradeSchema.safeParse(serializeForWire(t)).success).toBe(true);
    }
  });
});
