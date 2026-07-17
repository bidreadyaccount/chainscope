# Phase 4 handoff — Blockchain indexer

## What was built (`apps/indexer`)

- **ChainProvider abstraction** (`src/provider/types.ts`) with two implementations:
  - `LiveProvider` (`src/provider/live-provider.ts`) — viem `createPublicClient`; HTTP transport from
    `ROBINHOOD_RPC_URL` (falls back to the chain-config public RPC), optional WS transport from `ROBINHOOD_WS_URL`
    with `watchBlocks` and automatic fallback to interval polling; per-call timeout, `withRetry` exponential backoff
    with full jitter (`src/provider/retry.ts`), and a clock-injected `CircuitBreaker`
    (`src/provider/circuit-breaker.ts`) whose state is exposed via `provider.status()`.
  - `DemoProvider` (`src/provider/demo-provider.ts`) — network-free; synthesizes deterministic blocks whose logs are
    REAL ABI-encoded Uniswap V2/V3 Swap events built from the shared demo generator (`src/demo-fixtures.ts`), so the
    complete live path (block → getLogs → decode → normalize → ingest) runs in tests with zero RPC.
    `provider.firstBlock` seeds a checkpoint for bounded runs.
- **DEX adapter framework** (`src/adapters/`): `DexAdapter` interface; full V2 + V3 Swap decoders (trader-perspective
  signed deltas; V3 pool-perspective negation); V4 stub that throws `NotImplemented` (no fake decoding);
  `AdapterRegistry` matching by emitting address AND topic0, built ONLY from configuration — empty config ⇒ empty
  registry ⇒ "LIVE DECODING INACTIVE" log. No addresses are ever invented.
- **Normalization** (`src/normalize.ts`): DecodedSwap → NormalizedTrade. BUY = trader receives base token; raw
  amounts stay bigint→string; trader = event recipient, falling back to `txFrom` (router caveat documented in the
  module header); WETH wrap/unwrap and zero-base-movement excluded.
- **Price engine** (`src/pricing.ts`): SPEC §11 tiers 1 (stablecoin quote), 2 (wrapped-native quote × trusted ETH/USD
  reference) and 5 (null price, confidence 0 — never fabricated). Tiers 3–4 are documented future work (need a live
  pool graph).
- **Checkpointing + reorg safety** (`src/checkpoint.ts`): per-(chain, stream) `BlockCheckpoint` row with
  `lastIndexedHash` + a bounded `recentHashes` ring (new columns; migration
  `20260717010000_indexer_reorg_hashes`, applied to local PG). Processes only to head−CONFIRMATIONS; on divergence,
  bounded ancestor walk-back, transactional delete of post-fork trades, checkpoint reset, clean reprocess.
- **Backfill** (`src/backfill.ts`, CLI `src/backfill-cli.ts` → `pnpm --filter @chainscope/indexer backfill --from N --to M`):
  pages eth_getLogs over configured pools in bounded chunks (default 2000 blocks, clamped [1, 50000]) through the
  same decode→normalize→ingest path; idempotent via the pipeline upsert.
- **Engine** (`src/engine.ts`): main loop against the provider interface; reuses Phase 3's `Pipeline.ingest`
  unchanged; batch-level dedupe + persistence-level upsert; `IndexerErrorRecorder` persists failures; periodic
  `indexer_health` envelopes (lag, checkpoint, circuit, transport, pools).
- **Runtime config** (`src/runtime-config.ts`): demo runtime derives everything from the seed; live runtime reads
  pool/DEX configuration from the `LiquidityPool` + `Dex` tables (operator-supplied VERIFIED addresses) and
  stablecoins/wrapped-native from env.

## Verification (actually run)

- `pnpm -r typecheck` — all 6 projects pass. `pnpm lint` — clean. `pnpm test` — **282 tests / 25 files pass**
  (231 pre-existing + 51 new indexer tests: adapters 13, normalize 15, checkpoint/reorg 9, resilience 14 incl.
  circuit breaker/backoff/retry/chunking, DemoProvider e2e 5).
- Real-services run: `pnpm --filter @chainscope/indexer start` (DATA_MODE=demo) against local PG+Redis — registry
  built (30 pools), bounded catch-up completed idempotently against the existing `demo` checkpoint (already at head
  5043193; API demo stream is the producer), checkpoint row persisted, process idles publishing health.

## Live-mode requirements (operator supplies — NOTHING invented)

1. `ROBINHOOD_RPC_URL` (and optionally `ROBINHOOD_WS_URL`) — verified endpoints.
2. Rows in `Dex` (name, protocol = UNISWAP_V2 | UNISWAP_V3) and `LiquidityPool` (poolAddress, token0/token1,
   quote-token designation, dexId) with VERIFIED Robinhood Chain addresses.
3. `STABLECOIN_ADDRESSES` env (comma-separated) and optionally `WRAPPED_NATIVE_ADDRESS` + an ETH/USD reference
   source for price tier 2.
4. Set `DATA_MODE=live` — the API stops its demo stream; the indexer becomes the producer.
5. `CONFIRMATIONS` env tunes reorg caution (Arbitrum-stack soft finality is fast; default is conservative).

## Deviations / notes

- Contract-wallet detection is best-effort logging only in round 1 (NormalizedTrade has no field for it; noted for
  round 2).
- Demo-mode `start` performs one bounded catch-up as a live-path proof then idles — the API demo stream remains the
  demo producer (avoids double ingestion).
- Phase 4 tests use in-memory Prisma stubs for checkpoint/rollback so they run DB-free; the real-DB path is proven
  by the entrypoint run + Phase 3's integration tests.
