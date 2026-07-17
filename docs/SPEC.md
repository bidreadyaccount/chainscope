# ChainScope — Full Product Specification (client-provided)

> This is the client's full original specification. The MVP build follows `BUILD_BRIEF.md` at repo root, which trims
> this spec for round 1 and locks architecture decisions. Where they conflict, BUILD_BRIEF.md wins for the MVP.

## 1. Product objective

Create a responsive web application that monitors Robinhood Chain in real time, detects token buys and sells from
supported decentralized exchanges, classifies the wallets involved, aggregates their behaviour by token, and ranks
tokens according to the quality and direction of wallet activity.

The app must help users understand: which tokens are receiving the strongest net buying; whether buyers are whales,
profitable wallets, retail users, new wallets, bots, or deployer-linked wallets; whether whales and smart wallets are
accumulating or distributing; whether activity is broad and organic or concentrated among related wallets; whether
liquidity, volume, buyers and holders are increasing; what risks could invalidate a bullish signal; why each token
received its score. This is an analytics and decision-support product, not guaranteed financial advice.

## 2. Network configuration

Initially support only Robinhood Chain mainnet: chain name Robinhood Chain, chain ID 4663, native currency ETH,
public RPC fallback https://rpc.mainnet.chain.robinhood.com, production RPC env var ROBINHOOD_RPC_URL, production
WebSocket env var ROBINHOOD_WS_URL, explorer base URL https://robinhoodchain.blockscout.com. Do not hardcode private
API keys. Create a complete `.env.example`. The application must remain usable in demo mode when RPC credentials or
supported DEX addresses are unavailable.

## 3. Required architecture

Monorepo with pnpm workspaces and TypeScript throughout. Structure: apps/web, apps/api, apps/indexer,
packages/database, packages/shared, packages/config.

Frontend: Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui, TanStack Table, TanStack Query, TradingView
Lightweight Charts, Zustand only where local state is appropriate, native WebSocket or Socket.IO for live updates,
Lucide icons.

Backend API: Node.js, TypeScript, Fastify, Zod validation, REST endpoints, WebSocket stream for live trades, token
metrics and rankings, structured logging, centralized error handling, OpenAPI documentation.

Blockchain indexer: Node.js, TypeScript, Viem, WebSocket subscriptions when available, RPC polling fallback, block
checkpointing, reorg-safe confirmation logic, retry logic with exponential backoff, idempotent event processing,
historical backfill support, configurable DEX adapters.

Storage: PostgreSQL, Prisma ORM, Redis for caching, pub/sub and live rankings. Structure the analytics layer so
ClickHouse can be added later without rewriting the product.

Development infrastructure: Docker Compose for PostgreSQL and Redis, database migrations, seed script, demo-data
generator, ESLint, Prettier, type checking, unit tests, integration tests, a basic end-to-end test, health-check
endpoints, GitHub Actions CI.

## 4. Core data pipeline

Robinhood Chain RPC/WebSocket → block and log ingestion → DEX adapter and swap decoding → normalized trades → token
prices and liquidity → wallet profiles and classifications → rolling token metrics → ranking and risk engines →
PostgreSQL and Redis → REST and WebSocket API → dashboard.

Do not treat every ERC-20 transfer as a trade. Only classify transactions as buys or sells when they originate from a
recognized pool, router or swap event supported by a DEX adapter. Create a reusable DEX-adapter interface so
additional protocols can be plugged in later. Include adapters or scaffolding for Uniswap V2-style, V3-style, and
V4-style pools. DEX contract addresses must be configurable through environment variables or database configuration.
When no verified Robinhood Chain DEX addresses have been supplied, use demo mode instead of inventing addresses.

## 5. Normalized trade model

```ts
type NormalizedTrade = {
  id: string;
  chainId: 4663;
  transactionHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;

  dexName: string;
  routerAddress?: `0x${string}`;
  poolAddress: `0x${string}`;
  traderAddress: `0x${string}`;

  tokenAddress: `0x${string}`;
  tokenSymbol: string;
  quoteTokenAddress: `0x${string}`;
  quoteTokenSymbol: string;

  side: "BUY" | "SELL";
  tokenAmount: string;
  quoteAmount: string;

  priceUsd: number | null;
  valueUsd: number | null;
  priceConfidence: number;

  walletClass: WalletClass;
  walletClassificationConfidence: number;

  isDemo: boolean;
};
```

Correctly handle: router-mediated swaps, multi-hop swaps where feasible, decimal normalization, duplicate logs,
reverted transactions, missing token metadata, unknown USD prices, contract wallets, native ETH wrapping/unwrapping,
chain reorganizations.

## 6. Database schema

Normalized Prisma models for at least: Chain, BlockCheckpoint, Token, LiquidityPool, Dex, Trade, Wallet, WalletLabel,
WalletMetricSnapshot, WalletTokenPosition, WalletRelationship, TokenMetricSnapshot, TokenScoreSnapshot, Alert,
Watchlist, WatchlistToken, User, IndexerError. Unique constraints preventing duplicate processing of the same chain
ID, transaction hash and log index. Store raw integer blockchain quantities as strings or compatible high-precision
database values. Never use JavaScript floating-point numbers for onchain balances.

## 7. Wallet classifications

```ts
type WalletClass =
  | "MEGA_WHALE" | "WHALE" | "LARGE_TRADER" | "SMART_MONEY" | "RETAIL" | "NEW_WALLET"
  | "BOT" | "DEPLOYER_LINKED" | "MARKET_MAKER" | "PROTOCOL" | "UNKNOWN";
```

A wallet may hold several labels simultaneously; select a primary classification with explicit precedence rules.
Every classification includes: name, confidence 0–100, reasons, supporting metrics, last-calculated timestamp. Do not
present uncertain wallet relationships as facts — use wording like "Deployer-linked", "Possible bot", "Related funding
source", "High-confidence whale", "Insufficient history". Never label a wallet as an illegal insider.

## 8. Initial wallet-classification rules

Thresholds configurable via admin configuration file or database values. MVP defaults:

- Mega whale (any of): portfolio ≥ $1,000,000; single trade ≥ $100,000; controls ≥ 2% of a token's tracked
  circulating supply.
- Whale (any of): portfolio ≥ $250,000; single trade ≥ $25,000; controls ≥ 1% of tracked circulating supply.
- Large trader: typical trade ≥ $5,000, or portfolio ≥ $50,000.
- Retail: portfolio < $10,000, typical trade < $1,000, no stronger classification applies.
- New wallet: first observed tx within previous 7 days, or fewer than 5 lifetime observed transactions.
- Smart money weights: 30% realized profitability, 20% win rate, 15% entry timing, 15% consistency, 10% trade-count
  confidence, 10% risk-adjusted return. Minimum sample size required. Statuses: Candidate, Emerging, Confirmed.
- Bot probability from explainable indicators: launch-block purchase, extremely short reaction time, repeated
  identical amounts, abnormally high tx frequency, repetitive router/token patterns, many wallets funded by one
  source, very short holding periods.
- Deployer-linked: direct funding from token deployer, early token allocation, shared funding source, interaction
  before public trading, liquidity-management relationship. Show evidence and confidence.
- Market maker / protocol: exclude identified market-maker and protocol-flow activity from directional conviction
  metrics by default, with a user filter to include it.

## 9. Wallet profitability

Weighted-average cost-basis accounting. Per wallet-token position track: total purchased quantity, total sold
quantity, current quantity, average entry cost, realized P&L, unrealized P&L, total return, first entry time, last
trade time, average holding period, winning closed positions, losing closed positions. Do not count token transfers
into a wallet as profitable purchases. Mark metrics incomplete when historical data is insufficient.

## 10. Token metrics

Rolling windows: 1m, 5m, 15m, 1h, 4h, 24h. Per token and window: buy volume, sell volume, net flow, number of buys,
number of sells, unique buyers, unique sellers, buy/sell ratio, whale buy/sell volume and net flow, smart-money
buy/sell volume and net flow, retail net flow, new-wallet net flow, bot-associated volume, deployer-linked net flow,
average trade size, median trade size, price change, volume acceleration, liquidity change, holder growth where
available, buyer concentration, seller concentration, wallet-quality score, data-confidence score.

## 11. Price and liquidity engine

Price priority: (1) direct stablecoin pool; (2) native ETH pair converted to USD through a trusted reference price;
(3) route through the deepest liquid pool; (4) time-weighted pool estimate; (5) unknown price when confidence is
inadequate. Store: raw execution price, USD price, price source, price confidence, pool liquidity, quote asset,
timestamp. Do not display misleading market capitalization when supply or liquidity data is unreliable. Display
"Insufficient pricing data" rather than fabricating a price.

## 12. Opportunity score

Explainable 0–100 score. Initial formula: 25% smart-money net flow, 20% whale net flow, 15% unique-buyer growth,
10% buy/sell imbalance, 10% liquidity growth, 10% improvement in buyer quality, 5% volume acceleration, 5% price
confirmation, minus risk penalties. Normalize every component before combining.

Risk penalties: deployer-linked selling, liquidity removal, extreme holder concentration, wash-trading likelihood,
related-wallet concentration, very low liquidity, unverified token contract, abnormal transfer restrictions,
unreliable price, insufficient historical data.

Store and return the score breakdown; never return only an unexplained number. Labels: 80–100 Strong accumulation,
65–79 Positive accumulation, 50–64 Mixed, 35–49 Elevated selling, 0–34 Strong distribution. Also calculate a separate
risk score 0–100.

## 13. Rankings

Live rankings: overall opportunity, smart-money buying, whale accumulation, whale selling, retail momentum,
new-wallet surge, unusual volume, liquidity growth, deployer selling, coordinated-wallet activity, strongest
distribution, highest risk. Selectable by time window. Redis sorted sets for live rankings; persist historical
snapshots to PostgreSQL.

## 14. Required pages

A. Market Overview (main page, one token per row): rank; token icon/name/symbol; price; price change; age; liquidity;
market cap when reliable; buy volume; sell volume; unique buyers; unique sellers; whale net flow; smart-money net
flow; retail net flow; new-wallet activity; deployer-linked activity; opportunity score; risk score; signal; data
confidence. Include window selectors (1m–24h), search, sorting, column customization, saved filters, real-time row
updates, pause-live-updates control, mobile responsive cards, virtualized rows where appropriate.

B. Smart Money: tokens receiving smart-wallet accumulation; smart wallets active now; historical performance; buy
sizes; entry prices; net flow; confidence and sample size.

C. Whales: largest recent buys and sells; whale net flow by token; accumulating whales; distributing whales; wallet
holdings and concentration.

D. Live Trades: streaming feed with buy/sell, token, wallet, wallet class, USD value, quantity, DEX, transaction
time, explorer link. Restrained animation for new rows.

E. Token Detail: candlestick or line chart; price and liquidity; opportunity score; risk score; score explanation;
live trades; wallet-class distribution; net flow by wallet type; top buyers; top sellers; top holders when available;
smart-wallet activity; whale activity; new-wallet activity; deployer-linked activity; liquidity changes; holder
concentration; related-wallet cluster warnings; token contract information; explorer links; watchlist button; alert
creation.

F. Wallet Detail: wallet labels; classification confidence; portfolio estimate; realized and unrealized P&L; win
rate; current holdings; recent trades; best and worst trades; average trade size; average holding period; funding
sources; related wallets; bot probability; deployer relationships; explorer link.

G. Watchlist: add/remove tokens, current scores, recent changes, personal notes, alert configuration.

H. Methodology: explain every wallet label, token metric, score formula, risk penalty and known limitation in plain
language.

I. Settings and Data Status: RPC connection status, WebSocket status, last indexed block, current chain head,
indexing lag, database status, Redis status, demo/live-data status, supported DEX adapters, data coverage, API
latency. Do not expose private keys or sensitive environment variables.

## 15. Dashboard design

Professional institutional crypto-terminal aesthetic: dark by default, high information density without clutter,
near-black background, neutral cards and borders, green only for positive flow, red only for negative flow, amber for
caution/low confidence, blue for neutral information, strong numerical typography, tabular numerals, sticky table
headers, clear hover states, accessible contrast, tooltips explaining every advanced metric, skeleton loaders, empty
states, error states, mobile and tablet support. Do not create a marketing landing page as the primary output — the
main product dashboard is the default route. No excessive gradients, glass effects, oversized cards or decorative
animations.

## 16. Decision explanations

Deterministic evidence-based explanations from calculated metrics, e.g. positive factors ("Four confirmed
smart-money wallets bought $82,400 over 15 minutes") and risk factors ("The top five buyers account for 63% of recent
volume"). Do not use an LLM to invent market explanations — generate from actual metric thresholds and stored
evidence.

## 17. API requirements

REST: GET /health, /api/status, /api/tokens, /api/tokens/:address, /api/tokens/:address/trades,
/api/tokens/:address/metrics, /api/tokens/:address/score, /api/tokens/:address/holders, /api/rankings,
/api/trades/live, /api/wallets/:address, /api/wallets/:address/trades, /api/wallets/:address/positions,
/api/wallets/:address/relationships, /api/methodology; POST /api/watchlists, /api/watchlists/:id/tokens,
DELETE /api/watchlists/:id/tokens/:address, POST /api/alerts.

Support pagination, sorting, filtering, time-window selection, input validation, consistent error responses, rate
limiting, API versioning, OpenAPI documentation. WebSocket interface for new normalized trades, token metric updates,
score changes, ranking changes, indexer health.

## 18. Demo mode

Runs immediately without paid providers. Deterministic demo data: ≥30 tokens, ≥250 wallets, ≥5,000 historical
trades, streaming live trades, scenarios for whale accumulation, smart-money buying, retail-led momentum,
deployer-linked selling, coordinated new-wallet activity, liquidity removal, mixed/low-confidence cases. Demo mode
uses the same API contracts and frontend components as live mode. Visible "Demo Data" badge. DATA_MODE=demo|live.

## 19. Security and reliability

Environment-variable validation; no secrets in source control; parameterized DB access via Prisma; Zod validation;
address validation and checksumming; BigInt-safe serialization; rate limiting; secure HTTP headers; CORS; request
size limits; RPC timeout and retry logic; circuit breaker / provider-failure handling; reorg protection;
duplicate-event protection; sanitized logging; graceful shutdown; DB transactions where required.

Read-only analytics. Do NOT implement: custody, private-key storage, automated trading, copy trading, token swaps,
approval transactions, smart contracts, investment guarantees.

## 20. Testing

Meaningful tests for: buy/sell direction detection, swap-event normalization, token decimals, duplicate-log
prevention, cost-basis calculations, realized P&L, wallet classification, smart-money scoring, whale thresholds,
Token Opportunity Score, risk penalties, rolling-window aggregation, ranking order, low-confidence pricing, API
validation, demo/live data separation. E2E: open dashboard → view ranked tokens → change window → open token →
inspect score explanations → open wallet → add token to watchlist.

## 21. Documentation

README (product overview, architecture diagram, repo structure, install, env vars, Docker, migrations, demo mode,
live mode, adding DEX addresses, creating a DEX adapter, scoring, wallet labels, limitations, testing, deployment,
troubleshooting) plus ARCHITECTURE.md, METHODOLOGY.md, DEX_ADAPTER_GUIDE.md, DEPLOYMENT.md.

## 22. Execution rules

Inspect repo → plan → scaffold → schema → shared types → demo data → API → indexer → engines → frontend → live WS →
tests → lint/typecheck/build → fix → docs → report. Make reasonable engineering decisions without repeatedly asking
questions. Do not claim a feature works unless run/tested. Do not invent Robinhood Chain DEX/stablecoin/oracle
addresses or token metadata — put unresolved addresses in configuration and document what must be supplied. If a
live-data dependency is unavailable, complete the feature behind a provider interface and prove it through demo mode
and tests. Comments only for non-obvious blockchain or scoring logic. No placeholder buttons, dead navigation, fake
filters or static charts.

## 23. Definition of done

App starts locally from documented commands; Docker Compose starts PG and Redis; migrations and seeding succeed;
demo mode displays continuously updating trades and rankings; main token table functional and sortable; token and
wallet detail pages work; scores have visible explanations; watchlists work (round 2 in MVP); indexer has a real
Robinhood Chain provider interface; DEX adapters configurable and tested; no fabricated addresses; lint, typecheck,
tests and production builds pass; README and architecture docs complete.
