# Basket Router — the buyable layer (Shape 1)

_Design & build brief. Status: planner increment in progress; router contract next._

## What this is

ChainScope today is read-only: it computes baskets and shows what an investment
_would_ have done. The **Basket Router** is the layer that lets a user actually
act on a basket — in one click — **without anyone taking custody of their money**.

The user experience:

1. Start from a **prebuilt basket** (MAG7, AI & Compute, Semiconductors, …) or a
   **custom** one built in the Index Builder.
2. Optionally **retune the weights** to their own preference (same engine, same
   invariants as the curated indexes).
3. **Buy**, **sell**, or **rebalance** that basket whenever they want.

Every stock-token lands in — and is sold from — **the user's own wallet**. The
router is a helper that batches the swaps into a single transaction; it never
holds, pools, or manages anyone's assets.

## Guardrails (non-negotiable)

- **Non-custodial.** No pooling, no vault, no index token. The router moves tokens
  between the user's wallet and the DEX and back; it never holds a balance between
  transactions. This is the line that keeps Shape 1 out of "fund / collective
  investment" territory (Shape 2 is a separate, heavier product).
- **No auto-rebalancing in v1.** Rebalances are **user-triggered and user-signed**.
  A bot that rebalances people's wallets on a schedule looks like discretionary
  money management and needs standing permissions — deferred, not built.
- **Never invent an address.** Stock-token, DEX, and stablecoin addresses are
  **operator-supplied config**, exactly like ChainScope's live vs. demo split. The
  code ships with no real addresses; tests run against mock tokens and a mock DEX.
- **Eligibility is a first-class hook.** Our own research notes that **US users
  cannot legally hold Robinhood Chain stock-tokens**. The router therefore carries
  an optional **allowlist gate** (off by default in tests) so it _can_ be
  restricted to KYC'd / eligible addresses when a real deployment demands it. The
  legal determination is counsel's, not the code's — the code just makes gating
  possible.
- **Read-only until configured.** With no addresses wired, the UI shows the plan
  ("here's what you'd buy") but the execute button is inert — same honesty posture
  as the rest of ChainScope.

## Architecture

```
        ChainScope index engine            trade planner              router contract
        (the brain — DONE)                 (the maths — THIS)         (the hands — NEXT)
   ┌───────────────────────────┐    ┌──────────────────────────┐   ┌────────────────────────┐
   │ computeWeights /           │    │ planTrades(holdings,      │   │ buyBasket(plan)        │
   │ buildManualWeights         │──▶ │   targets, prices, cash)  │──▶│ sellBasket(plan)       │
   │ → target weightBps (=10000)│    │ → list of BUY/SELL swaps  │   │ rebalance(plan)        │
   └───────────────────────────┘    │   (USD + est. qty +       │   │ (non-custodial, atomic,│
                                     │    min-received)          │   │  slippage+deadline+    │
                                     └──────────────────────────┘   │  reentrancy guarded)   │
                                        pure, no addresses           │  addresses = config    │
                                                                     └────────────────────────┘
```

Three clean layers. The **brain** already exists and is audited (three rounds).
The **planner** is pure TypeScript — no chain, no addresses — so it is fully unit-
testable and fits the existing audit loop. The **hands** (a smart contract) simply
_execute a plan the planner produced_; it maps token IDs → real addresses from
config and does the swaps.

## Layer 1 — the trade planner (this increment)

`packages/shared/src/engines/trade-planner/`. Pure, deterministic, I/O-free —
same contract as the index engine (`@chainscope/config` for parameters; no DB,
network, or clock).

**Input:** the action (`BUY | SELL | REBALANCE`), the user's current holdings
(token qty), the target weights (bps, summing to 10000), a price map (USD per
token), and optional cash to add. Plus tolerances: slippage bps and a rebalance
no-trade band.

**Output — a `TradePlan`:** an ordered list of `{ ticker, side, amountUsd,
estQty, priceUsd, minReceived }` swaps, plus gross buy/sell totals, the net cash
the user must add or receives, the per-name target USD (for transparency), and any
names excluded for want of a usable price.

**The three actions:**

- **BUY** — split `cashUsd` across the priced targets by weight (largest-remainder
  apportionment on USD cents, so the dollars sum _exactly_), each a BUY swap.
  Unpriceable names are dropped and their weight renormalized across the rest,
  surfaced — never silently.
- **SELL** — full exit: one SELL swap per held name back to the stablecoin.
- **REBALANCE** — value the portfolio (`held × price` + any added cash), compute
  each name's target USD, and trade only the **difference**: overweight names are
  sold, underweight names are bought, names dropped from the target are sold to
  zero. A **no-trade band** (default 0.5% of the portfolio) suppresses dust churn;
  with no added cash the sells fund the buys and net cash ≈ 0.

**Invariants (asserted, in the engine's style):** every traded amount is finite
and positive; BUY dollars sum exactly to the cash in; post-trade implied weights
match the targets within the band; buys and sells reconcile. `minReceived`
encodes slippage per side (min **tokens** on a buy, min **USD** on a sell) so the
contract can revert rather than fill a bad price.

## Layer 2 — the router contract (done)

`packages/contracts/` — `src/BasketRouter.sol`, a single non-custodial contract:

- `buyBasket(legs, deadline)` — pull the total stablecoin (via the user's approval),
  swap each leg into its target token **delivered straight to the user**, refund any
  un-spent stablecoin.
- `sellBasket(legs, deadline)` — pull the user's tokens (via approval), swap each back
  to stablecoin sent to the user.
- `rebalance(sells, buys, cashInStable, deadline)` — run every sell to stablecoin held
  by the router, then fund the buys from those proceeds plus optional added cash,
  delivering bought tokens to the user and refunding the remainder. Atomic.

Cross-cutting, all implemented: **per-swap `minReceived`** (from the planner) +
**`deadline`** + **`ReentrancyGuard`**; **atomic** (whole basket or revert); a swap
**adapter seam** (`ISwapAdapter`) so the DEX is pluggable; an **operator token
registry** (`allowedToken`) so it can't be pointed at an arbitrary token; an optional
**user allowlist** (`userAllowlistEnabled`/`allowedUser`) for the eligibility gate;
**`Pausable`**; and per-fill events. Uses OpenZeppelin `SafeERC20`/`Ownable`.

**Non-custodial, proven:** every happy-path test asserts the router holds zero
stablecoin and zero tokens afterward. It cannot move funds without the user's ERC-20
approval and holds no keys.

### Toolchain note

The sandbox blocks Foundry's and solc's binary hosts (403), so tests use the pure-JS
`solc` compiler + an in-process `ganache` EVM driven by `ethers` — no native builds,
no downloads. Bytecode targets the `paris` EVM (ganache on the `merge` hardfork). The
contract is standard Solidity and ports to Foundry unchanged. Run: `pnpm --filter
@chainscope/contracts test` (11 router cases + a toolchain smoke test; ~50s).

## Build order

1. **Trade planner + tests** — ✅ done (pure maths; audit-ready).
2. **Router contract + tests** against mock ERC-20s and a mock DEX — ✅ done
   (buy / sell / rebalance + slippage, deadline, token-registry, allowlist, pause,
   owner-only, and reentrancy guards).
3. **Wiring** (next): API endpoint that returns a plan for an index+action; web
   buy/sell/rebalance flow on the index detail and builder pages (execute button inert
   until addresses are configured).
4. **External audit pass** (same loop as ChainScope), then a testnet dry-run.
5. Only after that, and with counsel: real addresses + eligibility gating + live.

## What stays deferred

Shape 2 (a pooled vault that issues a single index token) — the legally heavy
"real fund." Auto-rebalancing keepers. Fiat on-ramp. Cross-basket tax accounting.
These are real roadmap items, not part of the first buyable release.
