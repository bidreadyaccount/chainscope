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

---

## Re-audit remediation (round 2)

The external re-audit of commit `f351a3c` confirmed W-01/W-02/V-01/W-03 fully fixed (0 sum/cap
violations across 5,000 fuzz trials) and found 4 new Medium issues in the builder/simulator work. All
fixed (full suite 359 → **372**; engine 61 → 65; new web smoke test project):

- **R-04 (Med) — `/build` shipped as a dead link.** Root cause: root `.gitignore` had a bare `build/`
  rule that ignored the App Router route directory `apps/web/src/app/build/`, so the page existed
  locally (and in local builds) but was never committed/pushed. Fixed the ignore rule (negation for the
  source route), committed the page, and added a **nav-route smoke test**
  (`apps/web/src/nav-routes.smoke.test.ts`, new `web` vitest project) that fails if any nav `href`
  lacks an App Router `page.tsx` — so this class of dead-link regression is caught in CI.
- **R-01 (Med) — YTD accepted an arbitrarily stale pre-January reference.** `computePerformance` now
  requires the YTD reference to be within `YTD_REFERENCE_TOLERANCE_DAYS` (10) of Jan 1, else returns
  null (Dec 1 → 7-month "YTD" is rejected; Dec 29–31 accepted). Tests cover both.
- **R-02 (Med) — simulator projected a different portfolio than it allocated.** When a constituent is
  unpriced, the basket is renormalized to priced names, but the supplied level series is the FULL
  index's. `simulateInvestment` now suppresses the projection (`projectionAvailable:false` + reason,
  empty series, null totals) whenever anything is excluded, and each allocation exposes
  `realizedWeightBps` alongside the target `weightBps`. API + UI propagate the flag.
- **R-03 (Med) — duplicate manual constituents distorted concentration.** `buildManualWeights` now
  aggregates duplicate `stockTokenId` (sums weights → one exposure). The API `/indexes/preview` schema
  additionally rejects case-insensitive duplicate tickers and any `manualWeights` ticker not present in
  `tickers` (closes the silent-filter inconsistency the audit noted). Tests cover aggregation,
  collapse-below-minimum, and both 400s.

---

## Re-audit remediation (round 3)

Round-3 external audit of `d03109c` confirmed R-01..R-04 fixed, the engine clean through a third
5,000-book fuzz, and first-principles cross-checks matching exactly. It found 2 Medium + 2 Low, all in
the builder/simulator surface — all fixed (full suite 372 → **376**):

- **F-01 (Med) — realized simulator weights could sum to 9,999/10,001.** `realizedWeightBps` was rounded
  per-holding with `Math.round`. Now uses the shared largest-remainder rounder (`largestRemainderBps`,
  exported from the engine), so realized weights sum to EXACTLY 10000. Test: 4×2500 with one unpriced →
  `[3333,3333,3334]`.
- **F-02 (Med) — whitespace-padded duplicate tickers bypassed validation.** `/indexes/preview` now
  canonicalizes each ticker with `trim().toUpperCase()` at the Zod boundary (before dedup + before DB
  lookup) and rejects empty-after-trim, so `' AAPL'`/`'AAPL '`/`'AAPL'` collapse to one. Tests cover
  padded duplicates, padded-but-valid, and whitespace-only.
- **F-03 (Low) — Simulator showed target weight after renormalization.** The allocation table now shows
  the REALIZED weight (what the dollars actually buy) and, when it differs from target, shows the target
  alongside.
- **F-04 (Low) — Builder had no error/empty states.** `/build` now renders an error state on a failed
  `/stocks` query, an empty state for an empty registry, and a no-match state for a zero-result search.

## Re-audit remediation (round 4)

Round-4 external audit of `984fcab` confirmed F-01..F-04 fixed and the pure engine clean through a
fourth 5,000-book extreme-magnitude fuzz (zero sum/cap/infeasibility/NaN violations) with seeded MAG7
weights, level, returns and concentration matching first-principles exactly. It found 2 findings, both
in the simulator's dollar rounding — both fixed:

- **F-05 (Med) — rounded dollar allocations didn't reconcile to the investment.** `simulateInvestment`
  rounded each `allocationUsd` independently (`round(shares·price, 2)`), so a fully-priced book need not
  sum to `amountUsd` (audit fuzz: 2,706/5,000 cases drifted, max 4¢; e.g. `$1` over `[3333,3333,3334]`
  at `$1` → `$0.99`). Now the invested dollars are apportioned in **integer cents** by the realized
  weights with the same identity-stable largest-remainder rounder — promoted to shared math as
  `apportion(total, weights, ids)` (`packages/shared/src/engines/math.ts`) — so allocations sum to
  EXACTLY the investment. Tests: the exact `$1.00` repro, plus a 400-book seeded reconciliation fuzz;
  the API test now asserts exact cent conservation instead of `toBeCloseTo`.
- **F-06 (Low) — `shares` could contradict `allocationUsd`.** `shares` was rounded to 6 dp independently,
  so `shares·price` could differ from the dollars shown (e.g. `$1` at a `$10M` price → `shares: 0` beside
  `allocationUsd: 1`). `allocationUsd` (cent-exact) is now **authoritative** and `shares` is derived from
  it (`allocationUsd / price`, no destructive rounding), so `shares·price` matches the dollars for every
  accepted input. The `/simulate` route also rejects sub-cent amounts (`amount ≥ 0.01`), which cannot be
  represented in cents. Test: `$1` at `$10M` gives nonzero shares that reconcile; the random-book fuzz
  bounds `|shares·price − allocationUsd|`.

Note on the reported "4 failed / 50 skipped": all were API-project tests that need Postgres 16 + Redis 7,
which the audit environment could not start (`ECONNREFUSED 127.0.0.1:6379`) — an environment coverage
gap, not assertion failures. With Postgres + Redis up, all six projects pass (the F-05/F-06 tests and
the new shared-math/trade-planner tests raise the suite total above the prior 376).
