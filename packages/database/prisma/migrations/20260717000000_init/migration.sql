-- ChainScope initial schema (SPEC §6).
--
-- NOTE: This migration was authored to exactly match prisma/schema.prisma. In
-- the reference build environment the Prisma schema-engine binary host
-- (binaries.prisma.sh) is blocked by egress policy, so `prisma migrate dev`
-- could not generate this file; it was written by hand and applied to the local
-- database. End users with normal network access can run `prisma migrate deploy`
-- (or `prisma migrate dev`) and this migration applies unchanged.

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "WalletClassEnum" AS ENUM (
  'MEGA_WHALE', 'WHALE', 'LARGE_TRADER', 'SMART_MONEY', 'RETAIL', 'NEW_WALLET',
  'BOT', 'DEPLOYER_LINKED', 'MARKET_MAKER', 'PROTOCOL', 'UNKNOWN'
);

-- CreateTable
CREATE TABLE "Chain" (
  "id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "nativeSymbol" TEXT NOT NULL DEFAULT 'ETH',
  "rpcUrl" TEXT,
  "explorerUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Chain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockCheckpoint" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "stream" TEXT NOT NULL DEFAULT 'default',
  "lastIndexedBlock" BIGINT NOT NULL DEFAULT 0,
  "lastFinalizedBlock" BIGINT NOT NULL DEFAULT 0,
  "headBlock" BIGINT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlockCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dex" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "factoryAddress" TEXT,
  "routerAddress" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Dex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "address" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "decimals" INTEGER NOT NULL,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "firstSeenAt" TIMESTAMP(3),
  "circulatingSupply" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidityPool" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "address" TEXT NOT NULL,
  "dexId" TEXT NOT NULL,
  "baseTokenId" TEXT,
  "token0Address" TEXT NOT NULL,
  "token1Address" TEXT NOT NULL,
  "quoteTokenAddress" TEXT NOT NULL,
  "quoteTokenSymbol" TEXT NOT NULL,
  "feeTier" INTEGER,
  "liquidityUsd" DOUBLE PRECISION,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiquidityPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "transactionHash" TEXT NOT NULL,
  "logIndex" INTEGER NOT NULL,
  "blockNumber" BIGINT NOT NULL,
  "blockTimestamp" TIMESTAMP(3) NOT NULL,
  "dexName" TEXT NOT NULL,
  "routerAddress" TEXT,
  "poolAddress" TEXT NOT NULL,
  "traderAddress" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "tokenAddress" TEXT NOT NULL,
  "tokenSymbol" TEXT NOT NULL,
  "quoteTokenAddress" TEXT NOT NULL,
  "quoteTokenSymbol" TEXT NOT NULL,
  "side" "TradeSide" NOT NULL,
  "tokenAmount" TEXT NOT NULL,
  "quoteAmount" TEXT NOT NULL,
  "priceUsd" DOUBLE PRECISION,
  "valueUsd" DOUBLE PRECISION,
  "priceConfidence" DOUBLE PRECISION NOT NULL,
  "walletClass" "WalletClassEnum" NOT NULL,
  "walletClassificationConfidence" DOUBLE PRECISION NOT NULL,
  "walletId" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "address" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "lifetimeTxCount" INTEGER NOT NULL DEFAULT 0,
  "portfolioValueUsd" DOUBLE PRECISION,
  "primaryClass" "WalletClassEnum" NOT NULL DEFAULT 'UNKNOWN',
  "classificationConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isProfitable" BOOLEAN NOT NULL DEFAULT false,
  "fundingSourceAddress" TEXT,
  "botProbability" DOUBLE PRECISION,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLabel" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "labelClass" "WalletClassEnum" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "supportingMetrics" JSONB,
  "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletMetricSnapshot" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "window" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "realizedPnlUsd" DOUBLE PRECISION,
  "unrealizedPnlUsd" DOUBLE PRECISION,
  "winRate" DOUBLE PRECISION,
  "tradeCount" INTEGER NOT NULL DEFAULT 0,
  "avgTradeSizeUsd" DOUBLE PRECISION,
  "avgHoldingPeriodSec" DOUBLE PRECISION,
  "smartMoneyScore" DOUBLE PRECISION,
  "botProbability" DOUBLE PRECISION,
  CONSTRAINT "WalletMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTokenPosition" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "totalPurchasedRaw" TEXT NOT NULL DEFAULT '0',
  "totalSoldRaw" TEXT NOT NULL DEFAULT '0',
  "currentQtyRaw" TEXT NOT NULL DEFAULT '0',
  "avgEntryCostUsd" DOUBLE PRECISION,
  "realizedPnlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unrealizedPnlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalReturnUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "firstEntryAt" TIMESTAMP(3),
  "lastTradeAt" TIMESTAMP(3),
  "avgHoldingPeriodSec" DOUBLE PRECISION,
  "winningClosed" INTEGER NOT NULL DEFAULT 0,
  "losingClosed" INTEGER NOT NULL DEFAULT 0,
  "isComplete" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletTokenPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletRelationship" (
  "id" TEXT NOT NULL,
  "sourceWalletId" TEXT NOT NULL,
  "targetWalletId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenMetricSnapshot" (
  "id" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "window" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "buyVolumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sellVolumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "netFlowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "buyCount" INTEGER NOT NULL DEFAULT 0,
  "sellCount" INTEGER NOT NULL DEFAULT 0,
  "uniqueBuyers" INTEGER NOT NULL DEFAULT 0,
  "uniqueSellers" INTEGER NOT NULL DEFAULT 0,
  "buySellRatio" DOUBLE PRECISION,
  "whaleNetFlowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "smartMoneyNetFlowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "retailNetFlowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "newWalletNetFlowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "botVolumeUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "deployerNetFlowUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgTradeSizeUsd" DOUBLE PRECISION,
  "medianTradeSizeUsd" DOUBLE PRECISION,
  "priceChangePct" DOUBLE PRECISION,
  "volumeAcceleration" DOUBLE PRECISION,
  "liquidityChangePct" DOUBLE PRECISION,
  "holderGrowth" DOUBLE PRECISION,
  "buyerConcentration" DOUBLE PRECISION,
  "sellerConcentration" DOUBLE PRECISION,
  "walletQualityScore" DOUBLE PRECISION,
  "dataConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  CONSTRAINT "TokenMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenScoreSnapshot" (
  "id" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "window" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "opportunityScore" DOUBLE PRECISION NOT NULL,
  "riskScore" DOUBLE PRECISION NOT NULL,
  "signalLabel" TEXT NOT NULL,
  "breakdown" JSONB NOT NULL,
  CONSTRAINT "TokenScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "displayName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Default',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistToken" (
  "id" TEXT NOT NULL,
  "watchlistId" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "note" TEXT,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WatchlistToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "tokenId" TEXT,
  "type" TEXT NOT NULL,
  "threshold" DOUBLE PRECISION,
  "window" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerError" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "context" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "blockNumber" BIGINT,
  "txHash" TEXT,
  "severity" TEXT NOT NULL DEFAULT 'error',
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IndexerError_pkey" PRIMARY KEY ("id")
);

-- Indexes & unique constraints
CREATE UNIQUE INDEX "BlockCheckpoint_chainId_stream_key" ON "BlockCheckpoint"("chainId", "stream");
CREATE UNIQUE INDEX "Dex_chainId_name_key" ON "Dex"("chainId", "name");
CREATE UNIQUE INDEX "Token_chainId_address_key" ON "Token"("chainId", "address");
CREATE INDEX "Token_chainId_symbol_idx" ON "Token"("chainId", "symbol");
CREATE UNIQUE INDEX "LiquidityPool_chainId_address_key" ON "LiquidityPool"("chainId", "address");
CREATE INDEX "LiquidityPool_baseTokenId_idx" ON "LiquidityPool"("baseTokenId");
CREATE UNIQUE INDEX "Trade_chainId_transactionHash_logIndex_key" ON "Trade"("chainId", "transactionHash", "logIndex");
CREATE INDEX "Trade_tokenId_blockTimestamp_idx" ON "Trade"("tokenId", "blockTimestamp");
CREATE INDEX "Trade_tokenAddress_blockTimestamp_idx" ON "Trade"("tokenAddress", "blockTimestamp");
CREATE INDEX "Trade_walletId_blockTimestamp_idx" ON "Trade"("walletId", "blockTimestamp");
CREATE INDEX "Trade_traderAddress_blockTimestamp_idx" ON "Trade"("traderAddress", "blockTimestamp");
CREATE INDEX "Trade_blockTimestamp_idx" ON "Trade"("blockTimestamp");
CREATE INDEX "Trade_side_blockTimestamp_idx" ON "Trade"("side", "blockTimestamp");
CREATE UNIQUE INDEX "Wallet_chainId_address_key" ON "Wallet"("chainId", "address");
CREATE INDEX "Wallet_primaryClass_idx" ON "Wallet"("primaryClass");
CREATE INDEX "Wallet_fundingSourceAddress_idx" ON "Wallet"("fundingSourceAddress");
CREATE UNIQUE INDEX "WalletLabel_walletId_labelClass_key" ON "WalletLabel"("walletId", "labelClass");
CREATE INDEX "WalletMetricSnapshot_walletId_capturedAt_idx" ON "WalletMetricSnapshot"("walletId", "capturedAt");
CREATE UNIQUE INDEX "WalletTokenPosition_walletId_tokenId_key" ON "WalletTokenPosition"("walletId", "tokenId");
CREATE INDEX "WalletTokenPosition_tokenId_idx" ON "WalletTokenPosition"("tokenId");
CREATE UNIQUE INDEX "WalletRelationship_sourceWalletId_targetWalletId_relationType_key" ON "WalletRelationship"("sourceWalletId", "targetWalletId", "relationType");
CREATE INDEX "WalletRelationship_targetWalletId_idx" ON "WalletRelationship"("targetWalletId");
CREATE UNIQUE INDEX "TokenMetricSnapshot_tokenId_window_capturedAt_key" ON "TokenMetricSnapshot"("tokenId", "window", "capturedAt");
CREATE INDEX "TokenMetricSnapshot_tokenId_window_capturedAt_idx" ON "TokenMetricSnapshot"("tokenId", "window", "capturedAt");
CREATE UNIQUE INDEX "TokenScoreSnapshot_tokenId_window_capturedAt_key" ON "TokenScoreSnapshot"("tokenId", "window", "capturedAt");
CREATE INDEX "TokenScoreSnapshot_tokenId_window_capturedAt_idx" ON "TokenScoreSnapshot"("tokenId", "window", "capturedAt");
CREATE INDEX "TokenScoreSnapshot_window_opportunityScore_idx" ON "TokenScoreSnapshot"("window", "opportunityScore");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");
CREATE UNIQUE INDEX "WatchlistToken_watchlistId_tokenId_key" ON "WatchlistToken"("watchlistId", "tokenId");
CREATE INDEX "Alert_userId_idx" ON "Alert"("userId");
CREATE INDEX "Alert_tokenId_idx" ON "Alert"("tokenId");
CREATE INDEX "IndexerError_chainId_createdAt_idx" ON "IndexerError"("chainId", "createdAt");

-- Foreign keys
ALTER TABLE "BlockCheckpoint" ADD CONSTRAINT "BlockCheckpoint_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Dex" ADD CONSTRAINT "Dex_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Token" ADD CONSTRAINT "Token_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiquidityPool" ADD CONSTRAINT "LiquidityPool_dexId_fkey" FOREIGN KEY ("dexId") REFERENCES "Dex"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiquidityPool" ADD CONSTRAINT "LiquidityPool_baseTokenId_fkey" FOREIGN KEY ("baseTokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletLabel" ADD CONSTRAINT "WalletLabel_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletMetricSnapshot" ADD CONSTRAINT "WalletMetricSnapshot_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletTokenPosition" ADD CONSTRAINT "WalletTokenPosition_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletTokenPosition" ADD CONSTRAINT "WalletTokenPosition_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletRelationship" ADD CONSTRAINT "WalletRelationship_sourceWalletId_fkey" FOREIGN KEY ("sourceWalletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletRelationship" ADD CONSTRAINT "WalletRelationship_targetWalletId_fkey" FOREIGN KEY ("targetWalletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TokenMetricSnapshot" ADD CONSTRAINT "TokenMetricSnapshot_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TokenScoreSnapshot" ADD CONSTRAINT "TokenScoreSnapshot_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WatchlistToken" ADD CONSTRAINT "WatchlistToken_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WatchlistToken" ADD CONSTRAINT "WatchlistToken_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IndexerError" ADD CONSTRAINT "IndexerError_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
