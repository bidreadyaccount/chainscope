# ChainScope

Real-time onchain market intelligence and wallet analytics for **Robinhood Chain**. ChainScope ingests DEX swaps,
classifies the wallets behind them (whale, smart money, retail, new wallet, possible bot, deployer-linked, market
maker), aggregates behaviour per token over rolling windows (1m–24h), and ranks tokens with an explainable 0–100
**Opportunity Score** plus a separate **Risk Score** — every score ships with its full component breakdown and
deterministic, threshold-driven explanations (no LLM-generated market commentary, ever).

Read-only analytics and decision support. **Not financial advice.** No custody, no keys, no trading.

It also includes a **stock-token index layer**: a canonical registry of tokenized-stock assets and
curated index baskets (Magnificent 7, AI & Compute, Semiconductors, …) valued by a pure, tested index
engine — again analytics only, users hold the underlying stock tokens directly (no vault, no index
token). See `docs/handoff/INDEX_LAYER.md`.

## Architecture

```
Robinhood Chain RPC/WS ──▶ apps/indexer ──┐            ┌──▶ REST /api/v1/*
   (or deterministic        block → logs   │  Pipeline  │
    demo generator)         → DEX adapter  ├──ingest()──┤──▶ WebSocket /ws (trade/metrics/score/rankings/health)
                            → normalize    │            │
                                           └─▶ Postgres + Redis ──▶ apps/web (Next.js dashboard)
```

| Package             | What it is                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`          | Next.js 15 App Router dashboard (dark terminal UI, live WS updates)                                                            |
| `apps/api`          | Fastify v5 — REST + WebSocket + Redis rankings + demo streaming pipeline                                                       |
| `apps/indexer`      | viem-based chain indexer: providers, Uniswap V2/V3 adapters, reorg-safe checkpointing, backfill                                |
| `packages/shared`   | Types, Zod schemas, engines (classification, cost-basis P&L, metrics, scoring, explanations, **index engine**), demo generator |
| `packages/database` | Prisma 7 schema (22 models incl. stock-token index layer), migrations, seed                                                    |
| `packages/config`   | Chain config, env validation, every threshold/weight in one place                                                              |

## Quick start (demo mode — no RPC keys needed)

```bash
pnpm install
docker compose up -d          # Postgres 16 + Redis 7 (or use your own; see .env.example)
cp .env.example .env          # defaults are demo-ready
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm --filter @chainscope/api start    # :4000 — REST, WS, demo stream
pnpm --filter @chainscope/web dev      # :3000 — dashboard
```

`DATA_MODE=demo` (the default) runs a deterministic generator — 30 tokens, 250 wallets, ~5,700 seeded trades plus a
continuous live stream — through the **same pipeline, API contracts, and UI** as live mode, with a visible
"Demo Data" badge. Demo data is clearly fake (`0xDEMO…` hashes) and never presented as live.

## Live mode

Live mode needs operator-supplied, **verified** configuration — the codebase never invents addresses:

1. `ROBINHOOD_RPC_URL` (+ optional `ROBINHOOD_WS_URL`). Network parameters in `packages/config` came from the
   client spec and are marked unverified — confirm against the official Robinhood Chain docs first.
2. Verified DEX pool/router addresses in the `Dex` + `LiquidityPool` tables (see `docs/handoff/PHASE_4.md`).
3. `STABLECOIN_ADDRESSES` (+ optional wrapped-native + ETH/USD reference) for USD pricing tiers.
4. `DATA_MODE=live` — the API stops the demo stream; `pnpm --filter @chainscope/indexer start` becomes the producer.
   `pnpm --filter @chainscope/indexer backfill --from N --to M` backfills history idempotently.

With no pools configured the indexer logs `LIVE DECODING INACTIVE` and tracks the head only.

## Verification

```bash
pnpm -r typecheck   # strict TS, 6 projects
pnpm lint           # eslint flat config
pnpm test           # vitest: 318 tests (engines incl. index engine, API integration, indexer, e2e demo path)
pnpm --filter @chainscope/web build
```

## Docs

- `BUILD_BRIEF.md` — architect's contract (scope, guardrails, phase plan)
- `docs/SPEC.md` — full product spec; `docs/handoff/PHASE_1..5.md` — per-phase implementation notes
- Methodology is served at `/api/v1/methodology` and rendered at `/methodology` — generated from config thresholds
  so docs cannot drift from the engines

## Known limitations (round 1)

Watchlists/alerts return 501 (schema is ready); Smart Money & Whales appear as table columns/rankings rather than
dedicated pages; Uniswap V4 adapter is a stub; price tiers 3–4 (deepest-pool routing, TWAP) are future work;
candlestick aggregation pending; wallet labels are heuristics with stated confidence, not facts.
