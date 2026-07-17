# Phase 1 — Foundation (handoff)

Status: complete. `pnpm -r typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`,
and the Prisma migration + seed all pass against the local Postgres.

## What was built

- **pnpm monorepo** at repo root. Workspaces: `apps/web`, `apps/api`,
  `apps/indexer` (stubs — placeholder `src/index.ts` + tsconfig only) and
  `packages/config`, `packages/shared`, `packages/database`.
- **Root tooling**: `package.json` (private, exact-pinned deps, scripts below),
  `pnpm-workspace.yaml`, `.npmrc` (`save-exact=true`), `.gitignore`, `.env.example`,
  `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  Bundler resolution), `eslint.config.mjs` (flat config, typescript-eslint +
  prettier), `prettier.config.mjs`, `vitest.workspace.ts`, `docker-compose.yml`
  (postgres:16 + redis:7 with healthchecks — for end users; not used in this env).
- **packages/config** — chain config, Zod env validation, thresholds, time windows.
- **packages/shared** — types (NormalizedTrade, WalletClass), Zod schemas, WS
  envelope, BigInt serializer, seeded PRNG, deterministic demo-data generator +
  live stream factory.
- **packages/database** — full Prisma schema (18 models), singleton client with
  BigInt-safe helpers, hand-applied initial migration, deterministic seed.

## Root scripts

`dev`, `build`, `lint`, `typecheck`, `test`, `format`, `format:check`,
`db:generate`, `db:migrate`, `db:seed`, `db:reset`.

## Exact import surface for later phases

All internal packages resolve to their TS source (`main`/`exports` → `src/index.ts`),
so `tsx`, Vitest, and Next consume them directly with no pre-build.

### `@chainscope/config`
- Chain: `ROBINHOOD_CHAIN`, `ROBINHOOD_CHAIN_ID`, `getChainConfig`,
  `explorerTxUrl/AddressUrl/TokenUrl`, type `ChainConfig`.
- Env: `loadEnv()` (cached), `parseEnv`, `safeParseEnv`, `resetEnvCache`,
  `isLiveMode`, `isDemoMode`, `parseStablecoins`, `envSchema`, types `Env`, `DataMode`.
- Thresholds: `WALLET_THRESHOLDS`, `SMART_MONEY_WEIGHTS`, `SMART_MONEY_MIN_SAMPLE_SIZE`,
  `SMART_MONEY_STATUS_THRESHOLDS`, `BOT_INDICATORS`, `DEPLOYER_LINK`,
  `WALLET_CLASS_PRECEDENCE`, `OPPORTUNITY_WEIGHTS`, `RISK_PENALTIES`, `RISK_TRIGGERS`,
  `SIGNAL_BANDS`, `signalLabel()`, `PRICE_SOURCE_CONFIDENCE`,
  `MIN_DISPLAYABLE_PRICE_CONFIDENCE`, `MIN_TOKEN_DATA_CONFIDENCE`, `METRICS_CONFIG`,
  and the aggregate `THRESHOLDS`.
- Time windows: `TIME_WINDOWS`, `TIME_WINDOW_MS`, `TIME_WINDOW_LABEL`,
  `DEFAULT_TIME_WINDOW`, `isTimeWindow`, `timeWindowMs`, type `TimeWindow`.

### `@chainscope/shared`
- Types: `NormalizedTrade`, `SerializedTrade`, `TradeSide`, `WalletClass`,
  `WALLET_CLASSES`, `isWalletClass`, `WalletClassification`, `WalletLabelInfo`,
  `Hex`, `CHAIN_ID`, `WsEnvelope`, `WsMessageType`, `wsEnvelope()`. Time-window
  types are re-exported here too.
- Schemas (Zod): `serializedTradeSchema`, `addressSchema`, `txHashSchema`,
  `timeWindowSchema`, `walletClassSchema`, `tradeSideSchema`, `rawAmountSchema`,
  `wsEnvelopeSchema`, `rankingsQuerySchema`, `tokenListQuerySchema`,
  `tradesQuerySchema`, `tokenParamSchema`, `walletParamSchema`,
  `rankingCategorySchema` (+ `RankingCategory`).
- Utils: `serializeForWire`, `stringifyForWire`, `bigintReplacer`,
  `encodeTagged`/`decodeTagged`/`stringifyTagged`/`parseTagged`,
  `mulberry32`, `DEFAULT_SEED`, `seedFromString`, type `Rng`,
  `demoAddress`, `demoTxHash`, `demoId`, `hexStream`, `toRawAmount`, `fromRawAmount`.
- Demo generator (the key Phase 3 inputs):
  - `generateDemoDataset(seed?, now?) => { seed, now, tokens, wallets, trades, scenarioCounts }`
  - `createDemoTradeStream(seed?, intervalMs?) => { next(at?), start(onTrade)=>stop, seed, intervalMs }`
  - `generateTokens`, `generateWallets`, `buildPools`, `pickForScenario`,
    `valueForClass`, `buildTrade`, `DEMO_SCENARIOS`, `DEMO_ARCHETYPES`,
    types `DemoToken`, `DemoWallet`, `DemoDataset`, `DemoScenario`, `WalletPools`.

### `@chainscope/database`
- `prisma` (singleton, pg driver adapter), `disconnectPrisma()`,
  `serializeBigInt`, `stringifyBigInt`, `bigIntJsonReplacer`.
- Re-exports `Prisma`, `PrismaClient`, all enums (`TradeSide`, `WalletClassEnum`)
  and model types from the generated client.
- Client entrypoint path: `packages/database/src/client.ts`
  (imports the generated client at `packages/database/generated/client`).

## Demo dataset facts (seed 1337)

30 tokens, 250 wallets, **5739 trades** over a trailing 24h window. Every named
SPEC §18 scenario is present (whale accumulation, smart-money buying, retail
momentum, deployer selling, coordinated new wallets, liquidity removal,
mixed/low-confidence, plus organic). One token is deliberately unpriced
(`priceUsd = null`, confidence 0) → exercises "insufficient pricing data".
Decimals include 6/8/18. Bots emit rapid identical-size bursts. Tx hashes are
`0xDEMO…` (clearly synthetic); addresses are deterministic valid hex.

## IMPORTANT deviation — Prisma 7 + hand-applied migration (read before Phase 3/4)

The build environment's egress policy **blocks `binaries.prisma.sh`** (403), which
hosts every Prisma native engine (query + schema engine). Consequences and how it
was handled:

1. **ORM is Prisma 7.8.0**, not 6.x. Prisma 7's query compiler + `@prisma/adapter-pg`
   run entirely in JS/WASM, so the client needs **no native query engine** at
   runtime. `src/client.ts` constructs `new PrismaPg({ connectionString })` and
   passes it as `adapter`. `pg` (8.13.1) is a runtime dependency.
2. **Schema config is Prisma 7 style**: generator `provider = "prisma-client"`
   with `output = "../generated/client"`, `runtime = "nodejs"`,
   `importFileExtension = "js"`; the datasource has **no `url`** — the connection
   URL lives in `packages/database/prisma.config.ts` (`datasource.url = env("DATABASE_URL")`).
3. **Generated client is git-ignored** (`packages/database/generated/`). After a
   fresh `pnpm install` you MUST run `pnpm db:generate` before typecheck/tests/run.
   In this environment `prisma generate` also tries to fetch the schema-engine;
   generate succeeds by pointing the CLI at a dummy binary:
   `PRISMA_SCHEMA_ENGINE_BINARY=/tmp/dummy-engine PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 pnpm db:generate`.
   **End users with normal network access just run `pnpm db:generate`** (no env needed).
4. **Migration was applied by hand.** `prisma migrate dev` cannot run here (needs
   the blocked schema-engine). The initial migration
   `prisma/migrations/20260717000000_init/migration.sql` was authored to match the
   schema exactly, applied via `psql`, and recorded in `_prisma_migrations`. All 18
   tables exist and the seed inserts/read-backs succeed. **End users run
   `pnpm db:migrate` (dev) or `prisma migrate deploy` normally** — the migration
   applies unchanged.

If a future environment has network access to `binaries.prisma.sh`, everything
reverts to the standard Prisma flow with no code changes.

Other minor note: `apps/*` are stubs with a placeholder export so `pnpm -r typecheck`
has inputs; Phase 3/4/5 replace them.

## What Phase 2 (engines) needs to know

- Engines go in `packages/shared/src/engines/` as **pure functions** (no I/O).
  Import thresholds from `@chainscope/config` — do not hardcode numbers.
- Classification precedence is `WALLET_CLASS_PRECEDENCE`; smart-money weights,
  bot indicators, deployer-link and whale tiers are all in `thresholds.ts`.
- Opportunity score = `OPPORTUNITY_WEIGHTS` (sum 1.0) minus `RISK_PENALTIES`
  gated by `RISK_TRIGGERS`; label via `signalLabel()`. Separate 0–100 risk score.
- Feed engines with `NormalizedTrade[]` from `generateDemoDataset()`; each trade
  already carries `walletClass` + confidence for demo, but Phase 2 should compute
  classification from wallet history rather than trusting the demo label.
- Use `serializeForWire` for any bigint/Date leaving the process.

## Verification commands (all pass)

```
pnpm install
pnpm db:generate            # + dummy-engine envs in this sandboxed environment
pnpm -r typecheck
pnpm lint
pnpm test                   # 7 files, 50 tests
pnpm db:seed                # tokens:30 wallets:250 trades:5739
```
