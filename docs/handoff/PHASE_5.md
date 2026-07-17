# Phase 5 handoff — Frontend

## What was built (`apps/web`, Next.js 15.1.6 App Router, React 19, TS strict, Tailwind 3.4)

Routes (all verified 200 in a production `next start`, and the two main pages verified visually via headless
Chromium screenshots):

- `/` Market Overview — default route. 30-token ranked table: rank, symbol/name, price (or an amber
  "Insufficient pricing data" badge — never fabricated), liquidity, buy/sell volume, unique buyers/sellers, whale /
  smart-money / retail net flows (green strictly positive, red strictly negative), opportunity-score badge with
  signal, risk, data confidence. Window selector (1m–24h), search, click-to-sort headers, live refresh driven by WS
  `score` frames with a pause/resume control, tooltips on advanced columns.
- `/token/[address]` — summary header (price, liquidity ±%, verified badge, explorer link), area chart of recent
  priced trades (lightweight-charts 4.2; honest empty-state when no confidently priced trades), opportunity-score
  panel with the FULL component/penalty breakdown + deterministic positive/risk-factor explanations, live
  token-filtered trade feed, net-flow-by-wallet-class panel.
- `/wallet/[address]` — primary class chip + confidence, hedged labels with reasons, portfolio estimate,
  realized/unrealized P&L, win rate, positions table (with "partial" badges when history is incomplete), bot
  indicator panel, funding-source relationships, recent trades, explorer link.
- `/trades` — global streaming feed (WS `trade` channel): side, token, wallet + class chip, USD value,
  decimals-correct quantity, DEX, explorer-linked time; restrained 1.5s row highlight; pause control.
- `/methodology` — renders the API's structured methodology JSON (single source generated from config thresholds).
- `/status` — datastores, chain connection (incl. "network parameters unverified" warning), indexer checkpoint/lag,
  demo stream, adapters, coverage; 5s auto-refresh.

Shared: `lib/api.ts` (typed client — shapes captured from the live Phase 3 server), `lib/ws.ts` (auto-reconnecting
WS hook honoring the subscribe protocol and pause switch), `lib/format.ts` (BigInt-safe display formatting — raw
amounts are formatted with `BigInt` math, never parseFloat), `components/ui.tsx` (hand-rolled card/badge/chip/
skeleton/empty/error/tooltip primitives), nav with live Demo Data / Robinhood Chain badges, global footer
disclaimer. Dark terminal palette per SPEC §15 (near-black bg, neutral borders, green=positive flow only,
red=negative only, amber=caution, blue=neutral, tabular numerals, sticky headers, no gradients/glass).

## Verification (actually run)

- `pnpm -r typecheck` (6/6), `pnpm lint` (clean), `pnpm test` (282 pass) — all green with web included.
- `pnpm --filter @chainscope/web build` — production build succeeds (all 6 routes; `/` static-prerendered).
- Booted API (demo mode) + `next start`: all six routes return 200; headless-Chromium screenshots confirm the
  market table renders 30 live rows with scores/flows and the token page shows chart + full breakdown +
  explanations + live classified trades.

## Deviations (documented per brief)

- shadcn/ui: the needed primitives are hand-rolled in `components/ui.tsx` (same aesthetic, tiny surface) instead of
  installing the shadcn CLI toolchain.
- TanStack Table: the 13-column table uses a compact hand-rolled sortable table (TanStack Query is used everywhere
  for data). Column customization/saved filters are round-2 per the brief.
- Charts: token page charts recent trade execution prices (honest "trades we saw" line) rather than synthetic OHLC
  candles; candlesticks are round-2 once a real bar aggregation exists.
- Tooltips use native `title` with dotted-underline affordance (accessible, zero-dependency).
- `params` is a Promise in Next 15 — pages unwrap it with React `use()`.

## Env

`NEXT_PUBLIC_API_URL` (default http://localhost:4000), `NEXT_PUBLIC_WS_URL` (default ws://localhost:4000/ws) — both
already in `.env.example`.
