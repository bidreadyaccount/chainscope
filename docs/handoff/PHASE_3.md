# Phase 3 — API (handoff)

Status: complete. `pnpm -r typecheck`, `pnpm lint`, and `pnpm test` all pass
(**231 tests**: Phase 1+2's 195 + **36 new** API tests, 20 files). The server
was booted in demo mode and verified live (see "Live-boot verification").

Fastify v5 (TypeScript strict) server in `apps/api`: REST per SPEC §17 under
`/api/v1` (+ unversioned `/api` alias), a WebSocket stream, Redis sorted-set
rankings + pub/sub, and the demo streaming pipeline that Phase 4's indexer
reuses unchanged.

## How to run

```
# datastores already up locally (Postgres 5432, Redis 6379) and seeded
pnpm --filter @chainscope/api start     # tsx src/index.ts  (demo mode from .env)
pnpm --filter @chainscope/api dev       # watch mode
pnpm --filter @chainscope/api test      # vitest (needs PG + Redis)
```

Env comes from the repo-root `.env` (loaded by a tiny zero-dep loader,
`src/lib/load-dotenv.ts`, imported first so `@chainscope/database` sees
`DATABASE_URL` at module-eval time). Validated by `@chainscope/config`
`loadEnv()`. On demo boot the server: verifies seed data exists (runs
`pnpm db:seed` if the token table is empty), warms the pipeline from the last
24h of trades (persisting positions + a first snapshot + all rankings), starts
the demo stream, then listens. `/docs` serves Swagger UI; `/docs/json` the
OpenAPI 3.0.3 spec (39 paths).

## Versioning choice (documented)

`apiRoutes` (all REST endpoints, no prefix) is registered **twice**: under
`/api/v1` (canonical, versioned) and under `/api` (unversioned alias for the
literal SPEC §17 paths). `GET /health` and `GET /ws` are also registered at the
root. So both `/api/v1/tokens` and `/api/tokens` work; new versions can mount a
second router later without touching v1.

## Route inventory

All GET unless noted. Both `/api/v1/…` and `/api/…` resolve.

| Route | Notes |
|---|---|
| `/health` (root, and under both prefixes) | liveness |
| `/status` | mode, DB/Redis health+latency, RPC/WS config, indexer checkpoint + lag, demo-stream stats, adapters, coverage |
| `/tokens` | ranked list; `window`, `search`, `sort` (whitelist in `TOKEN_SORT_KEYS`), `order`, `limit`, `cursor` (offset). rank, price, liquidity, marketCap (only when price confident), per-class net flows, score, signal, dataConfidence |
| `/tokens/:address` | detail + pool + scenario + explorer link |
| `/tokens/:address/trades` | keyset paginated (`cursor` = blockTimestamp ms), `side`, `window` |
| `/tokens/:address/metrics` | full `TokenMetrics` for `window` |
| `/tokens/:address/score` | opportunity + risk, **full breakdown** (8 components + penalties) + **explanations** (positive/risk factors) |
| `/tokens/:address/holders` | top holders from `WalletTokenPosition`; honest `{available:false, reason, holders:[]}` when none |
| `/rankings` | Redis-backed; `type` **or** `category` (alias), `window`, `limit`. 12 categories |
| `/trades/live` | recent trades feed, keyset paginated |
| `/wallets/:address` | labels+confidences+reasons (via `classifyWallet`), portfolio est, realized/unrealized P&L, win rate, bot probability (`scoreBotProbability`), smart-money score, deployer relationships, funding peers |
| `/wallets/:address/trades` | keyset feed |
| `/wallets/:address/positions` | per-token positions (human qty + USD value) |
| `/wallets/:address/relationships` | relationships + shared-funding peers; honest note when empty |
| `/methodology` | static structured JSON (labels/metrics/formulas), generated from config thresholds so it can't drift |
| `POST /watchlists`, `POST /watchlists/:id/tokens`, `DELETE /watchlists/:id/tokens/:address`, `POST /alerts` | **501** `{ error: { code:"NOT_IMPLEMENTED", message:"Planned for round 2" } }` |
| `GET /ws` | WebSocket stream (below) |
| `/docs`, `/docs/json` | Swagger UI + OpenAPI |

Validation: every route validates params/query/body with the shared Zod schemas
(`@chainscope/shared`) via `parseOrThrow`; failures → `400 { error: { code:
"VALIDATION_ERROR", message, details:[{path,message}] } }`. Central error handler
in `server.ts` produces the consistent shape for 400/404/413/429/500/501.

## Pipeline ingest interface (for Phase 4)

`apps/api/src/pipeline/pipeline.ts` — `class Pipeline`. **Phase 4's indexer
constructs one Pipeline and calls `ingest(normalizedTrade)` per decoded swap.**
Identical path for demo + live.

```ts
new Pipeline({ prisma, rankings, pubsub, meta, logger, snapshotIntervalMs?, clock? });
await pipeline.init();                 // load token/wallet id + decimals caches
await pipeline.ingest(trade, opts?);   // the reusable entry point
await pipeline.warmup();               // replay last 24h from DB → positions + snapshot + rankings
```

`ingest(trade, opts)` steps (each toggleable via `opts`, all default true except
`forceSnapshot`):
1. persist `Trade` (upsert on `(chainId, txHash, logIndex)` — duplicate-event safe)
2. append the swap to the wallet-token event list, recompute the position with the
   Phase-2 `computePosition` cost-basis engine, upsert `WalletTokenPosition`
3. append to the token's in-memory **24h ring buffer** (pruned by `clock()`)
4. publish a `trade` envelope
5. recompute metrics for **all 6 windows** from the ring buffer (query-free) via
   the shared `computeTokenView` (same `computeTokenMetrics` +
   `computeOpportunityScore` the REST layer uses), update all 12 Redis ranking
   sorted sets, publish `token_metrics` + `score` (1h), and — throttled per token
   (`snapshotIntervalMs`, default 10s) — persist `TokenMetricSnapshot` +
   `TokenScoreSnapshot` for all windows.

`IngestOptions = { persistTrade?, persistPosition?, recompute?, publish?,
persistSnapshot?, forceSnapshot? }`. `warmup()` uses all-false during replay then
finalizes once. Phase 4 should feed the wallet's **classified** class on the
trade's `walletClass` field (demo trades already carry it; live decoders set it
from classification).

**Metrics strategy (documented choice):** the pipeline recomputes from an
in-memory per-token 24h ring buffer (no DB read on the hot path); the REST layer
recomputes from Postgres window queries. Both call the identical engines, so a
token's metrics/score are the same regardless of source. Prior-window growth
references are best-effort over the seeded 24h history.

**Token metadata in demo mode:** price / liquidity / liquidity-change / contract
verification come from `createDemoTokenMetaProvider(seed)` (the same deterministic
generator that produced the seed), because the DB does not persist price or
liquidity-change. In **live mode** Phase 4's price/liquidity engine should write
those to `Token`/`LiquidityPool` and a live `TokenMetaProvider` should read them.

## WebSocket protocol (`/ws`)

Server→client **data frames** are the shared envelope
`{ type: "trade"|"token_metrics"|"score"|"rankings"|"indexer_health", ts, data }`.
Server→client **control frames**: `{ ok:true, control:"welcome"|"subscribed"|
"unsubscribed"|"pong", ... }` and errors `{ error:{ code, message } }`.

Client→server:
```json
{ "action": "subscribe",   "channels": ["trade","score"], "tokens": ["0x…"] }
{ "action": "unsubscribe", "channels": ["score"] }
{ "action": "ping" }
```
A new connection starts subscribed to **all** channels / all tokens until it
narrows. `tokens` filters the token-scoped types (`trade`, `token_metrics`,
`score`) by `data.tokenAddress`. Heartbeat: server pings every 30s and evicts
sockets that miss a pong. Connection cap (default 500) and a 16 KiB message-size
limit; invalid/oversized/non-JSON messages get a structured error frame.

Fanout is driven by Redis pub/sub (`WsHub` subscribes once, forwards the exact
published payload), so a separate indexer process can publish and every API
instance fans out.

## Redis key + channel conventions (`src/lib/keys.ts`)

- Ranking sorted sets: `cs:rank:{category}:{window}` — member = token address,
  score = the category's ranking metric (see `rankingValue` in
  `services/rankings.ts`). Read highest-first (`ZREVRANGE`). 12 categories × 6
  windows.
- Pub/sub channels: `cs:ws:{type}` for each `WsMessageType`.

## Cross-cutting

Zod validation on every route; central error handler with the `{ error: {
code, message, details? } }` shape; `@fastify/helmet` (CSP off so Swagger UI
loads), `@fastify/cors` (origins from `WEB_ORIGIN`), `@fastify/rate-limit`
(`API_RATE_LIMIT_*`, structured 429), 256 KiB body limit; pino structured logs
with per-request ids; **BigInt-safe serialization globally** via
`setReplySerializer(stringifyForWire)` (bigint→string, Date→ISO) plus the shared
serializer used inside services; OpenAPI at `/docs`; graceful shutdown on
SIGTERM/SIGINT (`onClose`: stop stream → close WS hub → disconnect Redis →
disconnect Prisma).

## Tests (36 new)

- `lib/serialize.test.ts` (3) — BigInt/Date through JSON.
- `services/rankings.test.ts` (4) — `rankingValue` orientation; Redis write →
  highest-first readback with sequential ranks; limit.
- `pipeline/pipeline.test.ts` (1) — inject a synthetic `NormalizedTrade`; assert
  trade persisted, position updated (cost basis), ranking sorted set updated,
  snapshot persisted, `trade`+`score` envelopes published.
- `routes/http.test.ts` (26) — `fastify.inject()` against the seeded DB: every GET
  → 200 with schema-valid bodies (trades validated against
  `serializedTradeSchema`), score breakdown + explanations present, rankings
  non-empty from Redis, bad window/sort/address/category → 400, unknown
  token/wallet → 404, write endpoints → 501, unknown route → 404.
- `ws/ws.test.ts` (2) — connect via `injectWS`, subscribe, receive a published
  `trade` envelope; non-JSON message → structured error frame.

The demo stream is **off** during tests (only `index.ts` starts it); the HTTP
suite calls `pipeline.warmup()` in `beforeAll` to populate rankings/positions.
`apps/api` vitest runs `fileParallelism:false` (shared PG/Redis).

## Live-boot verification (actually run, demo mode)

- `GET /health` → `{"status":"ok",…}`.
- `GET /api/v1/status` → mode `demo`; DB+Redis `ok`; indexer checkpoint
  `lastIndexedBlock=5043193` lag `0`; demoStream `running:true` with a rising
  `ingested`; coverage tokens 30 / trades ~5.7k / positions ~2.6k.
- `GET /api/v1/tokens?window=1h` → 30-token ranked list, `rank` sequential,
  numeric scores + signal per row.
- token `/score?window=1h` → 8 components + penalties + `explanations`
  {positiveFactors, riskFactors}. 24h detail of a `DEPLOYER_SELLING` token shows
  signal "Strong distribution" (scenario-appropriate).
- `GET /api/v1/rankings?type=opportunity&window=1h` → non-empty from Redis, ranks
  1..N; `whale_accumulation&window=24h` shows multi-million whale net flows.
- WS client (subscribe trade/score/indexer_health): over 16s received 6 `trade`,
  6 `score`, 1 `indexer_health`, 2 control frames — continuous ~2.5s cadence.
- `/docs` → 200 HTML; `/docs/json` → OpenAPI 3.0.3, 39 paths; `/api/tokens`
  alias → 200; rate-limit headers present.
- SIGTERM → "graceful shutdown" + "demo-stream stopped" logged, process exits,
  subsequent curl refused.

## Deviations

1. **Zero-dep `.env` loader** (`src/lib/load-dotenv.ts`) + a vitest `env` loader
   in `apps/api/vitest.config.ts`. No `dotenv` dependency; the repo had no env
   auto-loading and `@chainscope/database` reads `DATABASE_URL` at import time.
2. **Manual Zod validation** (`parseOrThrow`) instead of
   `fastify-type-provider-zod` (its v7 needs zod ≥4; we pin zod 3.24.1). Gives
   full control over the error shape and BigInt handling. OpenAPI is generated
   from route `tags`/`summary` metadata (input schemas documented in prose).
3. **Global reply serializer** (`stringifyForWire`) rather than per-route response
   schemas — guarantees BigInt safety on every payload including errors.
4. **Demo token meta from the generator** (not the DB) because price /
   liquidity-change aren't persisted by the Phase-1 seed. Documented swap point
   for live mode above.
5. **`/rankings` accepts `type` and `category`** — the shared schema uses
   `category`; the brief/SPEC curl uses `type`. Both map to the same param.
6. **`unusual_volume`** ranks by total window volume (no persisted historical
   baseline for true acceleration); **`volumeAcceleration`** metric is null when
   no baseline (honest, not fabricated).
7. Warmup persists `WalletTokenPosition` for every wallet-token pair with events
   so `/holders` has data immediately; live ingest upserts per trade.

## What Phase 4 (indexer) needs

- Construct a `Pipeline`, `await init()`, and call `ingest(normalizedTrade)` per
  decoded swap. Reuse `RankingsService`, `PubSub`, and a live `TokenMetaProvider`
  (implement one backed by DB/price-engine writes; keep the same `TokenMeta`
  shape). Publishing to `cs:ws:*` fans out to all API WS clients automatically.
- Set `BlockCheckpoint` (stream e.g. `"live"`) so `/status` reports real
  `lastIndexedBlock`/`headBlock`/lag (the status route already reads the latest
  checkpoint for the chain).
