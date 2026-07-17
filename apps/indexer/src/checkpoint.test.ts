/**
 * Checkpoint + reorg-safety tests, run against an in-memory Prisma stub and a
 * fake provider serving a forked chain: advance/finality math, ring pruning,
 * fork-point discovery via the recorded-hash walk-back, and rollback (post-fork
 * trades deleted, checkpoint reset, clean idempotent reprocess).
 */
import { describe, expect, it } from 'vitest';
import type { Hex } from '@chainscope/shared';
import { CheckpointManager } from './checkpoint.js';
import type { ChainProvider, ProviderBlock } from './provider/types.js';

type Row = {
  lastIndexedBlock: bigint;
  lastFinalizedBlock: bigint;
  headBlock: bigint | null;
  lastIndexedHash: string | null;
  recentHashes: unknown;
};

/** Minimal in-memory stand-in for the Prisma surface CheckpointManager touches. */
function fakePrisma(initialTrades: bigint[] = []) {
  const row: Row = {
    lastIndexedBlock: 0n,
    lastFinalizedBlock: 0n,
    headBlock: null,
    lastIndexedHash: null,
    recentHashes: null,
  };
  // Trades represented only by their block numbers (that's all rollback filters on).
  let trades = [...initialTrades];
  const prisma = {
    blockCheckpoint: {
      upsert: async () => ({ ...row }),
      update: async ({ data }: { data: Partial<Row> }) => {
        Object.assign(row, data);
        return { ...row };
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({
        trade: {
          deleteMany: async ({ where }: { where: { blockNumber: { gt: bigint } } }) => {
            const before = trades.length;
            trades = trades.filter((bn) => bn <= where.blockNumber.gt);
            return { count: before - trades.length };
          },
        },
      }),
  };
  return { prisma: prisma as never, row, tradeBlocks: () => trades };
}

function hash(n: bigint, fork = ''): Hex {
  return `0x${fork}${n.toString(16).padStart(64 - fork.length, '0')}` as Hex;
}

/** Fake provider whose canonical chain is defined by a hash function. */
function fakeProvider(hashOf: (n: bigint) => Hex): ChainProvider {
  const block = (n: bigint): ProviderBlock => ({
    number: n,
    hash: hashOf(n),
    parentHash: n > 0n ? hashOf(n - 1n) : hash(0n),
    timestamp: 1_700_000_000n + n,
  });
  return {
    kind: 'demo',
    getBlockNumber: async () => 100n,
    getBlock: async (n) => block(n),
    getBlockByHash: async () => null,
    getLogs: async () => [],
    watchHeads: () => () => {},
    status: () => ({
      kind: 'demo',
      transport: 'demo',
      circuit: 'closed',
      consecutiveFailures: 0,
      lastHead: null,
    }),
    close: async () => {},
  };
}

const CFG = { chainId: 4663, stream: 'test', maxReorgDepth: 8 };

describe('CheckpointManager — advance', () => {
  it('advances tip, records hash, computes finalized = head - confirmations', async () => {
    const { prisma, row } = fakePrisma();
    const cp = new CheckpointManager(prisma, CFG);
    await cp.load();
    await cp.advance({ blockNumber: 10n, hash: hash(10n), headBlock: 15n, confirmations: 4 });
    expect(cp.getLastIndexedBlock()).toBe(10n);
    expect(cp.getLastIndexedHash()).toBe(hash(10n));
    expect(cp.getLastFinalizedBlock()).toBe(11n);
    expect(cp.nextBlock()).toBe(11n);
    expect(row.lastIndexedBlock).toBe(10n); // persisted
  });

  it('finalized never goes negative', async () => {
    const { prisma } = fakePrisma();
    const cp = new CheckpointManager(prisma, CFG);
    await cp.load();
    await cp.advance({ blockNumber: 1n, hash: hash(1n), headBlock: 2n, confirmations: 10 });
    expect(cp.getLastFinalizedBlock()).toBe(0n);
  });

  it('prunes the recent-hash ring beyond maxReorgDepth', async () => {
    const { prisma } = fakePrisma();
    const cp = new CheckpointManager(prisma, CFG);
    await cp.load();
    for (let n = 1n; n <= 20n; n++) {
      await cp.advance({ blockNumber: n, hash: hash(n), headBlock: 25n, confirmations: 2 });
    }
    expect(cp.hashAt(5n)).toBeUndefined(); // pruned (20 - 8 = 12 cutoff)
    expect(cp.hashAt(15n)).toBe(hash(15n));
    expect(cp.snapshot().recentCount).toBeLessThanOrEqual(9);
  });

  it('round-trips ring + tip through persistence (load hydrates)', async () => {
    const { prisma } = fakePrisma();
    const cp1 = new CheckpointManager(prisma, CFG);
    await cp1.load();
    await cp1.advance({ blockNumber: 7n, hash: hash(7n), headBlock: 9n, confirmations: 1 });
    const cp2 = new CheckpointManager(prisma, CFG);
    const snap = await cp2.load();
    expect(snap.lastIndexedBlock).toBe(7n);
    expect(snap.lastIndexedHash).toBe(hash(7n));
    expect(cp2.hashAt(7n)).toBe(hash(7n));
  });
});

describe('CheckpointManager — reorg detection + rollback', () => {
  async function indexedUpTo(cp: CheckpointManager, tip: bigint): Promise<void> {
    for (let n = 1n; n <= tip; n++) {
      await cp.advance({ blockNumber: n, hash: hash(n), headBlock: tip, confirmations: 0 });
    }
  }

  it('returns null when the tip is still canonical', async () => {
    const { prisma } = fakePrisma();
    const cp = new CheckpointManager(prisma, CFG);
    await cp.load();
    await indexedUpTo(cp, 10n);
    expect(await cp.findForkPoint(fakeProvider((n) => hash(n)))).toBeNull();
  });

  it('finds the last common ancestor when the chain forked', async () => {
    const { prisma } = fakePrisma();
    const cp = new CheckpointManager(prisma, CFG);
    await cp.load();
    await indexedUpTo(cp, 10n);
    // Chain reorged: blocks > 7 now have different hashes.
    const forked = fakeProvider((n) => (n > 7n ? hash(n, 'ff') : hash(n)));
    expect(await cp.findForkPoint(forked)).toBe(7n);
  });

  it('rollbackTo deletes post-fork trades, resets tip, and reprocess is clean', async () => {
    const { prisma, tradeBlocks } = fakePrisma([5n, 6n, 7n, 8n, 9n, 10n]);
    const cp = new CheckpointManager(prisma, CFG);
    await cp.load();
    await indexedUpTo(cp, 10n);

    const deleted = await cp.rollbackTo(7n);
    expect(deleted).toBe(3); // blocks 8, 9, 10
    expect(tradeBlocks()).toEqual([5n, 6n, 7n]);
    expect(cp.getLastIndexedBlock()).toBe(7n);
    expect(cp.getLastIndexedHash()).toBe(hash(7n));
    expect(cp.nextBlock()).toBe(8n);
    expect(cp.hashAt(9n)).toBeUndefined(); // ring pruned above fork

    // Reprocess the forked range cleanly with the new canonical hashes.
    for (let n = 8n; n <= 10n; n++) {
      await cp.advance({ blockNumber: n, hash: hash(n, 'ff'), headBlock: 10n, confirmations: 0 });
    }
    const provider = fakeProvider((n) => (n > 7n ? hash(n, 'ff') : hash(n)));
    expect(await cp.findForkPoint(provider)).toBeNull(); // canonical again

    // Idempotent: rolling back to the same fork again deletes nothing.
    expect(await cp.rollbackTo(10n)).toBe(0);
  });

  it('falls back to the bounded floor when no ancestor matches in the window', async () => {
    const { prisma } = fakePrisma();
    const cp = new CheckpointManager(prisma, CFG);
    await cp.load();
    await indexedUpTo(cp, 20n);
    // Entire recorded history diverged.
    const fullyForked = fakeProvider((n) => hash(n, 'ee'));
    const fork = await cp.findForkPoint(fullyForked);
    expect(fork).toBe(20n - 8n); // floor = tip - maxReorgDepth
  });
});
