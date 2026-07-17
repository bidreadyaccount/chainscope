# Phase 2 — Analytics Engines (handoff)

Status: complete. `pnpm -r typecheck`, `pnpm lint`, `pnpm test`, and
`pnpm --filter @chainscope/{config,shared} build` all pass.
Tests: **195 passed** (Phase 1's 50 + **145 new** engine tests), 15 files.

## What was built

Pure, I/O-free engines in `packages/shared/src/engines/` (BUILD_BRIEF §6). No DB,
no network, no clock reads — `now` is passed in where a timestamp is needed. All
thresholds/weights come from `@chainscope/config`; nothing numeric is hardcoded
in engine logic. New engine surface is re-exported from `@chainscope/shared`
root (`export * from './engines/index.js'`).

```
engines/
  math.ts                         clamp/clamp01/tanhNormalize/logCountConfidence/mean/median/topNShare/round
  classification/                 classifyWallet, scoreSmartMoney, scoreBotProbability
  pnl/                            computePosition
  metrics/                        computeTokenMetrics
  scoring/                        computeOpportunityScore
  explanations/                   generateExplanations, formatUsd/formatPct/formatCount
  integration.test.ts             end-to-end demo pipeline
```

## Config additions (packages/config/src/thresholds.ts)

The brief requires weights live in config. Added (all also on the `THRESHOLDS`
aggregate):

- `BOT_INDICATOR_WEIGHTS` — points per fired bot indicator.
- `DEPLOYER_EVIDENCE_WEIGHTS` — points per deployer-link evidence item.
- `SMART_MONEY_NORMALIZATION` — `{ roiScale, riskAdjustedScale, tradeCountTarget }`.
- `WALLET_QUALITY_WEIGHTS` — per-`WalletClass` quality (0..1) for token wallet-quality.
- `DATA_CONFIDENCE_WEIGHTS` — `{ priceCoverage: 0.6, sampleSize: 0.4 }`.
- `CONCENTRATION_TOP_N` — 5.
- `OPPORTUNITY_NORMALIZATION` — per-component tanh scales.
- `EXPLANATION_THRESHOLDS` — significance gates for §16 sentences.
- Also exported `WalletClassName` type.

**Bug fix:** `signalLabel()` now matches on the band **lower bound only**, so
fractional scores in a band interior resolve correctly (79.99 → "Positive
accumulation", 80 → "Strong accumulation") instead of falling into the integer
gap between a band's `max` and the next band's `min`. `SIGNAL_BANDS` data is
unchanged; Phase 1's contiguity/coverage tests still pass.

## Engine exports, signatures, and the input types the API/indexer must assemble

### Classification — `@chainscope/shared`
- `classifyWallet(w: WalletActivitySummary, now?: number | Date): WalletClassification`
- `scoreSmartMoney(input: SmartMoneyInput): SmartMoneyScore`
- `scoreBotProbability(w: WalletActivitySummary): BotScore`

`WalletActivitySummary` (assembled from wallet history): `address`,
`portfolioValueUsd`, `tradeSizesUsd: number[]`, optional `largestTradeUsd`,
`firstSeenDaysAgo`, `txCount`, optional `maxSupplyControlFraction`, relationship
flags (`isFundedByDeployer`, `hasEarlyTokenAllocation`,
`interactedBeforePublicTrading`, `hasLiquidityManagementRelationship`,
`fundingSourceSharedCount`), known-entity flags (`isKnownMarketMaker`,
`isKnownProtocol`), `timing?: WalletTimingStats`, `smartMoney?: SmartMoneyInput`.

`SmartMoneyInput`: `realizedProfitUsd`, `investedUsd`, `closedPositions`,
`winningPositions`, `losingPositions`, optional `entryTimingScore`/
`consistencyScore` (0..1, default 0.5), optional `avgReturnPerPosition`/
`returnStdDev` (risk-adjusted; neutral 0.5 when absent).

Output uses the Phase-1 `WalletClassification`/`WalletLabelInfo` contract.
**Note:** label objects carry `lastCalculatedAt` (the established field); the
brief's `calculatedAt` maps to it.

### Cost-basis P&L — `@chainscope/shared`
- `computePosition(input: PnlInput): PositionState`

`PnlInput`: `{ decimals, currentPriceUsd: number|null, events: PnlTradeEvent[] }`.
`PnlTradeEvent`: `{ side, kind: 'SWAP'|'TRANSFER_IN'|'TRANSFER_OUT',
tokenAmountRaw: string(bigint), quoteValueUsd: number|null, timestamp: ms }`.
Events may be unordered — the engine sorts by timestamp. Raw quantities in
`PositionState` are **bigint**; serialize with `serializeForWire` on the wire.

### Rolling token metrics — `@chainscope/shared`
- `computeTokenMetrics(input: TokenMetricsInput): TokenMetrics`

`TokenMetricsInput`: `{ window, windowStartMs, windowEndMs, trades: MetricTrade[],
prior?, currentPriceUsd?, currentLiquidityUsd?, baselineVolumeUsd?, holdersNow?,
holdersPrior?, options? }`. `MetricTrade`: `{ side, valueUsd: number|null,
priceConfidence, walletClass, traderAddress, timestamp }`. The caller must
project each `NormalizedTrade` into a `MetricTrade` **using the wallet's
computed classification** (not necessarily the raw demo label). `options`:
`{ includeMarketMakerFlow?, includeProtocolFlow? }`.

### Opportunity + risk scoring — `@chainscope/shared`
- `computeOpportunityScore(input: OpportunityInput): ScoreResult`

`OpportunityInput`: `{ components: OpportunityComponents, risk: RiskInputs }` —
both projected directly from a `TokenMetrics` result plus token-level risk
evidence (liquidity, price/data confidence, contract verification). `ScoreResult`
returns `score`, `scorePreClamp`, `baseScore`, `signal`, full `components[]`
(raw/normalized/weight/contribution), `penalties[]`
(applied/maxPenalty/severity/evidence), `totalPenalty`, and a separate
`riskScore` (0..100).

### Explanations — `@chainscope/shared`
- `generateExplanations(input: ExplanationInput): { positiveFactors, riskFactors }`

`ExplanationInput`: `{ metrics: TokenMetrics, score: ScoreResult, window?,
counts?, liquidityUsd?, priceConfidence? }`. Deterministic, threshold-driven,
no LLM. `formatUsd`/`formatPct`/`formatCount` are exported for reuse.

## Classification precedence (chosen, per SPEC §7)

`WALLET_CLASS_PRECEDENCE` (config), earlier wins:
`PROTOCOL > MARKET_MAKER > DEPLOYER_LINKED > BOT > MEGA_WHALE > WHALE >
SMART_MONEY > LARGE_TRADER > NEW_WALLET > RETAIL > UNKNOWN`. Rationale: known
entities (protocol/MM) dominate because their flow is excluded from conviction
metrics; relationship risk (deployer) and automation (bot) outrank raw size;
size tiers, then proven skill, then generic size, then provenance caveats, then
the retail default. `classifyWallet` emits **all** applicable labels, orders them
by precedence, and picks the highest as primary. Rationale is documented in
`classify.ts`.

## Normalization approach (deterministic, no magic)

- Signed magnitudes (net flows, growth, quality delta, acceleration, price
  confirmation, ROI, Sharpe) → `0.5 + 0.5*tanh(x / scale)`; a zero input maps to
  the neutral 0.5. Scales in `OPPORTUNITY_NORMALIZATION` / `SMART_MONEY_NORMALIZATION`.
- Already-bounded `[-1,1]` inputs (buy/sell imbalance) → linear `(x+1)/2`.
- Counts (smart-money trade-count confidence) → `log1p(n)/log1p(target)`.
- Opportunity base = `100 * Σ(weightᵢ · normᵢ)` (weights sum to 1 → base ∈
  [0,100]); risk penalties subtract points scaled by severity past their trigger;
  final score clamped to [0,100]. **Identity (tested):** `Σ contribution ===
  baseScore` and `baseScore − totalPenalty === scorePreClamp`.
- `riskScore = clamp(totalPenalty, 0, 100)` — a separate 0..100 scale.
- Directional conviction `netFlowUsd` **excludes MARKET_MAKER and PROTOCOL flow
  by default**; `options` re-includes them. Raw buy/sell volumes always include
  all classes, and MM/protocol volume is reported separately.

## Cost-basis rules (SPEC §9)

Weighted-average (moving-average) cost. Only **SWAP buys** establish basis;
`TRANSFER_IN` adds balance but no cost (flags `transfer_in_untracked_cost`).
Selling beyond tracked inventory realizes only the tracked portion and flags
`sell_exceeds_tracked_inventory`. Zero/unknown-price legs never fabricate a value
(`zero_price_buy` / `zero_price_sell`); a null mark price yields null unrealized
and flags `unpriced_open_position`. A realizing sell is one closed lot →
winning/losing counts. Avg holding period is tracked via a qty-weighted entry
clock.

## Test counts (145 new)

`classify` 23 · `smart-money` 10 · `bot` 10 · `cost-basis` 22 · `token-metrics`
22 · `opportunity` 31 · `explanations` 19 · `integration` 8.

Covers: every §8 threshold boundary (portfolio at exactly $250k/$1M, single-trade
$25k/$100k, supply 1%/2%, new-wallet 7d/5tx, retail <$10k), precedence
resolution, smart-money sample-size gate and status tiers, all bot indicators at
threshold, hand-computed cost-basis fixtures (6/8/18 decimals, multi-buy/
multi-sell, sells beyond inventory, transfers ignored, zero-price), median/
concentration/net-flow-by-class/MM-exclusion, weight sums, breakdown-sum
identity, every risk penalty firing, signal-label boundaries (79.99 vs 80), each
explanation trigger, and a deterministic end-to-end demo pipeline (classification
→ P&L → metrics → scoring → explanations).

## Deviations

1. Extended `packages/config/src/thresholds.ts` with the engine weights listed
   above (the brief mandates weights live in config, not engines).
2. Fixed `signalLabel()`'s fractional-gap bug (lower-bound match). Data unchanged.
3. `WalletLabelInfo.lastCalculatedAt` is used where the brief said `calculatedAt`
   — kept the Phase-1 contract field name rather than diverging from it.

## What Phase 3 (API) needs to know

- Engines are synchronous pure functions; call them after loading trades/wallet
  history from Postgres/Redis. Feed metrics the **classified** wallet class.
- Serialize any `bigint`/`Date` leaving the process with `serializeForWire`
  (`PositionState` raw quantities are bigint).
- `ScoreResult` already contains the full breakdown to persist to
  `TokenScoreSnapshot`; `generateExplanations` consumes `TokenMetrics` +
  `ScoreResult` directly.
