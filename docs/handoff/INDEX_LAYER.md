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

---

## Audit remediation (round 1) + builder/simulator

An external audit of commit `117b4ec` found real defects in the index engine. All confirmed findings
are fixed and covered by new tests (engine tests grew 27 → 61; full suite 318 → 359).

- **W-01 (High) — non-finite inputs.** `NaN`/`±Infinity` passed the old `<= 0` check and produced
  `NaN` weights with `ok:true`. Fixed: `basisFor`/`buildManualWeights` reject non-finite with a
  `NON_FINITE` reason; `computeWeights` validates the normalized total and every fraction, and asserts
  the exact-10000 sum + cap compliance before returning `ok:true` (else `error:'INVARIANT_FAILED'`).
  Fuzz test: 1000 random books per methodology, magnitudes 1e-6…1e200.
- **W-02 (Med) — cap could be exceeded.** The proportional redistribution loop could stop before
  convergence. Replaced with a finite **water-filling** active-set algorithm (≤ N passes), cap-aware
  integer rounding (remainder bumps skip names at cap), and an explicit **`CAP_INFEASIBLE`** result
  when `cap × N < 10000` (no more silently over-cap "equal" book). Fuzz test asserts every returned
  weight ≤ cap across 1000 random capped books.
- **V-01 (Med) — missing price silently dropped NAV.** `buildBasket` now excludes unpriced
  constituents into a surfaced `excluded[]`, reports `investedWeightBps`, and renormalizes the priced
  names so the basket stays fully invested and the level starts at `baseValue` (not silently below).
- **V-02 (Med) — stale window returns.** `windowReturn` now returns null when the series doesn't span
  the horizon or the reference is materially staler than requested (tolerance = max(2d, 50%)); YTD is
  null unless a real year-start reference exists. Demo history extended to 250 days so YTD is genuine.
- **W-03 (Low) — order-biased tie-break.** Largest-remainder ties now break on constituent identity,
  so output is independent of input ordering (permutation test).
- **S-02 (Low) — duplicate timestamps.** `computePerformance` de-duplicates by timestamp
  (last-write-wins) before computing returns/volatility.
- **N-01 (Low).** Documented boundary: `fromRawAmount` is display-only; raw amounts stay string/bigint
  in storage and on the wire and do not feed index math. (No behavior change; flagged for callers.)

### New: index builder + portfolio simulator (both read-only, engine-backed)

- `buildManualWeights()` — normalizes arbitrary user weights to exactly 10000 bps with the same
  hardened cap/rounding path. `simulateInvestment()` — splits an amount into per-constituent
  USD/shares (via `buildBasket`, so unpriced names are surfaced) and projects value over an index
  level series. Both in `packages/shared/src/engines/index-engine/`, with `builder.test.ts` (9 tests).
- API: `POST /api/v1/indexes/preview` (compute-only, no persistence) and
  `GET /api/v1/indexes/:slug/simulate?amount=` (no order placed). 7 new integration tests.
- Web: `/build` (pick names, methodology or manual weights, live preview) and a **Simulator** panel on
  the index detail page. Benchmark comparison is shown only when a real benchmark series exists —
  otherwise the UI states it is unavailable rather than fabricating one (guardrail).
