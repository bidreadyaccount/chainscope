# Stock-token index layer — handoff & audit notes

This layer adds a canonical stock-token registry and curated index baskets on top of ChainScope's
backend. It is **analytics/visualization only** — no custody, no vault, no ERC-20 index token, no
order placement. Users are assumed to hold the underlying stock tokens directly.

## What to audit (and where)

The audit-critical logic is the **pure index engine** in
`packages/shared/src/engines/index-engine/` — no I/O, fully unit-tested, deterministic:

- `weights.ts` — `computeWeights(constituents, methodology, constraints)`. **The invariant that
  matters: output bps always sum to exactly 10000** (largest-remainder/Hamilton rounding). Verify:
  - every methodology (EQUAL, MARKET_CAP, PRICE, INVERSE_VOL, CAP_CAPPED) sums to 10000;
  - constituents missing the needed input are *excluded with a reason*, not defaulted;
  - CAP_CAPPED caps each name at `maxWeightBps` and redistributes excess to uncapped names,
    with a bounded iteration count and a documented fallback when the cap is infeasible
    (cap × N < 100%).
- `valuation.ts`:
  - `buildBasket` / `computeLevel` — level = NAV / divisor; divisor starts at 1 so level starts at
    `baseValue`. **Rebalance continuity is a property test** (`valuation.test.ts` →
    "rebalance NAV/level continuity"): reallocating the same NAV across new weights leaves the level
    unchanged at the rebalance instant.
  - `computePerformance` — windowed returns pick the last point at/before the cutoff; volatility is
    stdev(consecutive returns)·√252 (documented daily-spacing assumption); max drawdown is the worst
    peak-to-trough.
  - `computeConcentration` — HHI on weight fractions, effective N = 1/HHI (equal-weight N names →
    HHI 1/N, effective N = N — asserted).
  - `computeTurnoverBps` — half the summed absolute weight change; a name entering/leaving counts its
    full weight.

Tests: `weights.test.ts` (14) + `valuation.test.ts` (13) = 27 engine tests, plus 9 API integration
tests in `apps/api/src/routes/indexes.test.ts` (weights sum to 10000 over the wire, cap respected,
sector allocation reconciles, cross-references consistent, 404s).

## Data model (`packages/database/prisma/schema.prisma`)

- `StockToken` — canonical registry (ticker, company, sector, industry, contract/price-feed
  addresses [nullable until verified], decimals, price, market cap, shares outstanding, dividend
  yield, volatility, risk rating, oracle status, …). `@@unique([chainId, ticker])`.
- `Index` — a basket: slug, symbol, methodology, `maxWeightBps`, benchmark, `baseValue`, `divisor`.
- `IndexConstituent` — membership + `targetWeightBps` (persisted so a basket is reproducible).
- `IndexNavSnapshot` — historical `level` / `navUsd` / `divisor` for charts.

Migration `20260717020000_stock_index_layer` (hand-authored SQL, applied to local PG and recorded in
`_prisma_migrations`; end users run `pnpm db:migrate`/`migrate deploy` normally). Numeric-safety
convention preserved: `sharesOutstanding` is a String; prices/weights/levels are derived Floats/ints.

## Demo data (`packages/shared/src/demo/stocks.ts`)

Deterministic: 24 illustrative stock tokens (well-known tickers for realism) and 8 curated indexes
(Magnificent 7, AI & Compute, Semiconductors, Cybersecurity, Clean Energy, EV, Dividend Leaders,
Healthcare). Per-stock daily price history is a seeded geometric random walk ending exactly at the
current price, so index NAV series are realistic and stable for a given (seed, now).

**Guardrails honored:** every row is `isDemo: true` with clearly-fake `0xDEMO…` contract/feed
addresses. No real Robinhood Chain / stock-token / oracle addresses are invented. The UI labels
everything "Demo" and states these are illustrative, not investment advice, not real tokenized
securities.

## API (`/api/v1`)

- `GET /indexes` — curated list with latest level, 30d/YTD return, volatility.
- `GET /indexes/:slug` — constituents + weights, sector allocation, concentration, performance, NAV
  history (computed on read by the engine from stored weights + current prices + NAV snapshots).
- `GET /stocks` (optional `?sector=`) — registry list.
- `GET /stocks/:ticker` — detail + which indexes hold it (cross-reference).

## Frontend

`/indexes` (cards), `/indexes/[slug]` (NAV chart with base-1000 reference line, performance/risk,
constituents with weight bars, sector allocation), `/stock/[ticker]` (metadata + index memberships).
Same dark terminal system as the rest of the app.

## Deliberately deferred to the next pass

Custom **index builder** (drag/drop, live weight editing) and **portfolio simulator** ($ → shares,
allocation, vs SPY/NASDAQ). The engine already exposes everything both need (`computeWeights`,
`buildBasket`, `computeTurnoverBps`), so they are additive — no rework.

## Known limitations

- Volatility is a static per-stock input in demo mode; a live build would compute it from the price
  history the engine already produces.
- Benchmarks (SPY/QQQ/…) are labels only — no benchmark return series is ingested yet, so
  "vs benchmark" is display context, not a computed relative return.
- NAV history uses a buy-and-hold basket between rebalances (no intra-series rebalancing in the demo
  seed); the engine supports rebalancing and the continuity is tested, but the demo seed does not
  schedule mid-series rebalances.
