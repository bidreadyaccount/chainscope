# ChainScope — Architect's Build Brief (v1)

This document is the authoritative contract for all builder agents. Read it fully before writing code.
The full product spec lives in `docs/SPEC.md`. Where this brief trims or overrides the spec, THIS BRIEF WINS for the MVP.

## Product in one paragraph

ChainScope is a real-time onchain market-intelligence dashboard for Robinhood Chain mainnet. It ingests DEX swaps,
classifies the wallets behind them (whale / smart money / retail / new wallet / bot / deployer-linked / market maker),
aggregates behaviour per token over rolling windows, and ranks tokens with an explainable 0–100 Opportunity Score and
a separate Risk Score. Read-only analytics. No custody, no trading, no smart contracts, no LLM-generated explanations.

## Locked architecture decisions (do not relitigate)

1. **Monorepo**: pnpm workspaces. Layout:
   ```
   apps/web        Next.js 14+ App Router frontend
   apps/api        Fastify REST + WebSocket server
   apps/indexer    viem-based chain indexer + DEX adapter framework
   packages/database  Prisma schema, client, migrations, seed
   packages/shared    types, Zod schemas, engines (classification, P&L, metrics, scoring, explanations), demo-data generator
   packages/config    chain config, env validation, constants, thresholds
   ```
2. **TypeScript strict everywhere.** Pinned exact dependency versions (no `^`/`~`).
3. **Demo mode is the default and must fully work with zero external services beyond Postgres/Redis.**
   `DATA_MODE=demo|live`. Live mode requires RPC env vars + DEX addresses supplied via config/DB. **Never invent
   Robinhood Chain contract addresses, DEX addresses, stablecoin addresses, or token metadata.** Unresolved addresses
   go in `.env.example` with comments explaining what must be supplied.
4. **Chain config** (packages/config): chainId 4663, name "Robinhood Chain", native ETH,
   rpc fallback `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com`.
   NOTE: these values came from the client and are NOT independently verified — keep them in one config module with a
   comment saying operators must verify against https://docs.robinhood.com/chain before live use.
5. **Numeric safety**: raw onchain quantities are `bigint` in code and `String`/`Decimal` in Postgres. JS `number`
   only for derived USD values and scores. All BigInt serialization through a shared safe serializer.
6. **Engines are pure functions** in `packages/shared/src/engines/` — no I/O, no DB, fully unit-testable. The API and
   indexer call them. This is the most important testability decision in the project.
7. **Demo-data generator is deterministic**: seeded PRNG (e.g. mulberry32 with fixed seed), generates 30 tokens,
   250 wallets, 5000 historical trades embodying named scenarios (whale accumulation, smart-money buying, retail
   momentum, deployer selling, coordinated new wallets, liquidity removal, mixed/low-confidence). Live demo stream =
   same generator emitting new trades on an interval through the same pipeline as live mode.
8. **Redis**: sorted sets for live rankings, pub/sub for WS fanout. Postgres for persistence + historical snapshots.
9. **This build environment has no Docker daemon.** Postgres 16 runs natively (db `chainscope`, user `chainscope`,
   password `chainscope`, localhost:5432) and Redis on localhost:6379. STILL ship a `docker-compose.yml` for end
   users — just don't use it to verify locally here.
10. **Testing**: Vitest for unit/integration. Engines get the dense tests (direction detection, decimals, cost basis,
    classification thresholds, scoring, rolling windows, dedup). E2E deferred to round 2.

## Core-MVP scope (trimmed from full spec — round 1)

IN: Market Overview page (main route `/`), Token Detail, Wallet Detail, Live Trades, Methodology (concise), a compact
Data Status panel (in a `/status` page), REST API + WS, engines, indexer skeleton with Uniswap V2/V3 adapter
scaffolding, demo mode, README + ARCHITECTURE.md + METHODOLOGY.md.

OUT (round 2): Watchlists UI, Alerts, saved filters, column customization, Smart Money & Whales dedicated pages
(their data appears as ranking filters on the main table), Uniswap V4 adapter, e2e test, DEX_ADAPTER_GUIDE.md,
DEPLOYMENT.md, user accounts. Prisma schema SHOULD still include Watchlist/WatchlistToken/Alert/User tables so round 2
needs no migration rewrite.

## Interface contracts (all phases must match these)

- `NormalizedTrade` exactly as in docs/SPEC.md §5.
- `WalletClass` union exactly as in docs/SPEC.md §7.
- Time windows: `"1m" | "5m" | "15m" | "1h" | "4h" | "24h"`.
- Opportunity Score formula + risk penalties per SPEC §12; thresholds in `packages/config/src/thresholds.ts`.
- REST routes per SPEC §17 (watchlist/alert POST routes may 501 in round 1 with clear error body).
- WS message envelope: `{ type: "trade" | "token_metrics" | "score" | "rankings" | "indexer_health", ts: string, data: T }`.
- Signal labels: 80–100 Strong accumulation / 65–79 Positive accumulation / 50–64 Mixed / 35–49 Elevated selling / 0–34 Strong distribution.

## Phase plan and handoffs

Each phase ends with: code compiling (`pnpm -r typecheck`), its tests passing, a short `docs/handoff/PHASE_N.md`
noting what was built, deviations, and what the next phase needs. Do not leave the repo broken between phases.

- **Phase 1 — Foundation**: scaffold monorepo, tooling (eslint flat config, prettier, vitest, tsconfig base),
  packages/config (env validation with Zod, chain config, thresholds), packages/database (full Prisma schema per SPEC
  §6 incl. round-2 tables, migrations run against local PG, seed script), packages/shared (types + Zod schemas +
  BigInt serializer + seeded PRNG + demo-data generator), docker-compose.yml, .env.example, root scripts.
- **Phase 2 — Engines**: classification, cost-basis P&L, rolling token metrics, opportunity + risk scoring,
  deterministic explanation generator. Heavy unit tests.
- **Phase 3 — API**: Fastify, REST per contract, WS stream, Redis rankings + pub/sub, demo streaming service that
  pumps generator trades through engines → DB/Redis → WS. OpenAPI via fastify swagger. Rate limiting, security
  headers, structured logging (pino), health/status endpoints.
- **Phase 4 — Indexer**: viem client factory, provider interface (live | demo), block checkpointing, N-confirmation
  reorg safety, retry/backoff, idempotent processing keyed on (chainId, txHash, logIndex), DEX adapter interface +
  Uniswap V2 and V3 swap decoders (tested against synthetic logs), config-driven adapter registry, backfill command.
- **Phase 5 — Frontend**: Next.js App Router, Tailwind + shadcn/ui, TanStack Table + Query, lightweight-charts,
  dark near-black terminal aesthetic (green=positive flow only, red=negative only, amber=caution, blue=neutral,
  tabular numerals), pages per scope, live WS updates with pause control, tooltips on advanced metrics, skeletons,
  empty/error states, Demo Data badge, responsive.
- **Phase 6 — Verification**: full lint/typecheck/test/build, boot everything in demo mode, click-through, fix, docs.

## Non-negotiable guardrails

- No secrets in code or git. No fabricated addresses. No fake "live" labels on demo data.
- No placeholder buttons or dead nav in shipped pages (that's why watchlist UI is OUT, not stubbed).
- Never claim something works without running it.
- Wallet-label wording stays hedged: "Deployer-linked", "Possible bot", "High-confidence whale" — never accusations.
- Every score shown with its breakdown; "Insufficient pricing data" instead of fabricated prices.
