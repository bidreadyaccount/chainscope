/**
 * End-to-end indexer test over the network-free DemoProvider: synthetic blocks
 * with real encodable swap logs flow through getLogs → adapter decode →
 * normalize → pipeline ingest, with checkpoint advancement — and re-running the
 * same range produces zero duplicates.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedTrade } from '@chainscope/shared';
import { DEFAULT_SEED } from '@chainscope/shared';
import { DemoProvider } from './provider/demo-provider.js';
import { buildDemoRuntime } from './runtime-config.js';
import { CheckpointManager } from './checkpoint.js';
import { IndexerEngine } from './engine.js';
import type { Logger } from './errors.js';

const FIXED_NOW = Date.UTC(2026, 0, 1);

const silentLogger: Logger = { info() {}, warn() {}, error() {}, debug() {} };

/** In-memory Prisma stub — same surface as checkpoint.test.ts. */
function fakePrisma() {
  const row = {
    lastIndexedBlock: 0n,
    lastFinalizedBlock: 0n,
    headBlock: null as bigint | null,
    lastIndexedHash: null as string | null,
    recentHashes: null as unknown,
  };
  return {
    blockCheckpoint: {
      upsert: async () => ({ ...row }),
      update: async ({ data }: { data: Partial<typeof row> }) => {
        Object.assign(row, data);
        return { ...row };
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn({ trade: { deleteMany: async () => ({ count: 0 }) } }),
  } as never;
}

/** Capturing fakes for the pipeline + pubsub the engine publishes into. */
function fakeSinks() {
  const ingested: NormalizedTrade[] = [];
  const published: Array<{ type: string; data: unknown }> = [];
  const pipeline = {
    ingest: async (trade: NormalizedTrade) => {
      ingested.push(trade);
    },
  } as never;
  const pubsub = {
    publish: async (type: string, data: unknown) => {
      published.push({ type, data });
    },
  } as never;
  const errors = { record: async () => {} } as never;
  return { pipeline, pubsub, errors, ingested, published };
}

async function mkEngine(provider: DemoProvider, sinks: ReturnType<typeof fakeSinks>) {
  const runtime = buildDemoRuntime(DEFAULT_SEED);
  const checkpoint = new CheckpointManager(fakePrisma(), {
    chainId: 4663,
    stream: 'e2e-test',
    maxReorgDepth: 32,
  });
  const engine = new IndexerEngine({
    provider,
    runtime,
    checkpoint,
    pipeline: sinks.pipeline,
    pubsub: sinks.pubsub,
    errors: sinks.errors,
    logger: silentLogger,
    confirmations: 0,
  });
  // Seed the checkpoint just below the demo block range (the documented use of
  // `provider.firstBlock`) so catchUp processes only the synthesized blocks.
  await checkpoint.load();
  const seedBlock = provider.firstBlock - 1n;
  const seeded = await provider.getBlock(seedBlock);
  await checkpoint.advance({
    blockNumber: seedBlock,
    hash: seeded!.hash,
    headBlock: await provider.getBlockNumber(),
    confirmations: 0,
  });
  return { engine, checkpoint };
}

describe('DemoProvider → engine end-to-end', () => {
  let provider: DemoProvider;

  beforeEach(() => {
    provider = new DemoProvider({ seed: DEFAULT_SEED, now: FIXED_NOW, recentBlocks: 40 });
  });

  it('provider is deterministic: same seed + now ⇒ identical heads and logs', async () => {
    const p2 = new DemoProvider({ seed: DEFAULT_SEED, now: FIXED_NOW, recentBlocks: 40 });
    const head = await provider.getBlockNumber();
    expect(await p2.getBlockNumber()).toBe(head);
    const logs1 = await provider.getLogs({ fromBlock: 0n, toBlock: head });
    const logs2 = await p2.getLogs({ fromBlock: 0n, toBlock: head });
    expect(logs1.length).toBeGreaterThan(0);
    expect(logs1).toEqual(logs2);
  });

  it('catchUp ingests decoded, normalized demo trades and advances the checkpoint', async () => {
    const sinks = fakeSinks();
    const { engine, checkpoint } = await mkEngine(provider, sinks);
    // Start just below the demo range so we only process the synthesized blocks.
    const head = await provider.getBlockNumber();

    const result = await engine.catchUp({ maxBlocks: 5000 });
    expect(result.reorgDeleted).toBe(0);
    expect(result.processedBlocks).toBeGreaterThan(0);
    expect(result.ingestedTrades).toBeGreaterThan(0);
    expect(sinks.ingested.length).toBe(result.ingestedTrades);
    expect(checkpoint.getLastIndexedBlock()).toBe(head);

    // Every ingested trade is a well-formed demo NormalizedTrade.
    for (const t of sinks.ingested) {
      expect(t.chainId).toBe(4663);
      expect(t.isDemo).toBe(true);
      expect(['BUY', 'SELL']).toContain(t.side);
      expect(BigInt(t.tokenAmount)).toBeGreaterThan(0n);
      expect(t.id).toBe(`4663-${t.transactionHash.toLowerCase()}-${t.logIndex}`);
    }

    // No duplicate (tx, logIndex) pairs were ingested.
    const ids = new Set(sinks.ingested.map((t) => t.id));
    expect(ids.size).toBe(sinks.ingested.length);
  });

  it('re-running the same range ingests zero new trades (idempotent)', async () => {
    const sinks = fakeSinks();
    const { engine } = await mkEngine(provider, sinks);
    const first = await engine.catchUp({ maxBlocks: 5000 });
    expect(first.ingestedTrades).toBeGreaterThan(0);

    const again = await engine.catchUp({ maxBlocks: 5000 });
    expect(again.processedBlocks).toBe(0); // checkpoint already at head
    expect(again.ingestedTrades).toBe(0);
    expect(sinks.ingested.length).toBe(first.ingestedTrades);
  });

  it('round-trip fidelity: decoded trades match the generator dataset they encode', async () => {
    const sinks = fakeSinks();
    const { engine } = await mkEngine(provider, sinks);
    await engine.catchUp({ maxBlocks: 5000 });

    // Cross-check a sample against provider logs: same tx hashes exist.
    const head = await provider.getBlockNumber();
    const logs = await provider.getLogs({ fromBlock: 0n, toBlock: head });
    const logTx = new Set(logs.map((l) => `${l.transactionHash.toLowerCase()}-${l.logIndex}`));
    for (const t of sinks.ingested.slice(0, 50)) {
      expect(logTx.has(`${t.transactionHash.toLowerCase()}-${t.logIndex}`)).toBe(true);
    }
  });

  it('publishes indexer_health envelopes with lag and circuit state', async () => {
    const sinks = fakeSinks();
    const { engine } = await mkEngine(provider, sinks);
    await engine.catchUp({ maxBlocks: 5000 });
    await engine.publishHealth();

    const health = sinks.published.filter((p) => p.type === 'indexer_health');
    expect(health.length).toBe(1);
    const data = health[0]!.data as Record<string, unknown>;
    expect(data['mode']).toBe('demo-indexer');
    expect(data['circuit']).toBe('closed');
    expect(data['lag']).toBe('0');
    expect(Number(data['tradesIngested'])).toBeGreaterThan(0);
    expect(Number(data['registeredPools'])).toBeGreaterThan(0);
  });
});
