-- Stock-token index layer: canonical stock-token registry + curated index
-- baskets + NAV history. Analytics only (no custody/vault/index-token).

CREATE TABLE "StockToken" (
  "id" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "ticker" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "sector" TEXT NOT NULL,
  "industry" TEXT,
  "description" TEXT,
  "contractAddress" TEXT,
  "decimals" INTEGER NOT NULL DEFAULT 18,
  "priceFeedAddress" TEXT,
  "priceUsd" DOUBLE PRECISION,
  "priceConfidence" INTEGER NOT NULL DEFAULT 0,
  "marketCapUsd" DOUBLE PRECISION,
  "sharesOutstanding" TEXT,
  "dividendYield" DOUBLE PRECISION,
  "volatility" DOUBLE PRECISION,
  "assetClass" TEXT NOT NULL DEFAULT 'EQUITY',
  "country" TEXT NOT NULL DEFAULT 'US',
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "riskRating" TEXT,
  "colorTheme" TEXT,
  "tradingEnabled" BOOLEAN NOT NULL DEFAULT true,
  "oracleStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StockToken_chainId_ticker_key" ON "StockToken"("chainId", "ticker");
CREATE INDEX "StockToken_sector_idx" ON "StockToken"("sector");

CREATE TABLE "Index" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "methodology" TEXT NOT NULL,
  "maxWeightBps" INTEGER NOT NULL DEFAULT 10000,
  "rebalanceSchedule" TEXT NOT NULL DEFAULT 'QUARTERLY',
  "benchmark" TEXT,
  "baseValue" DOUBLE PRECISION NOT NULL DEFAULT 1000,
  "divisor" DOUBLE PRECISION,
  "isCurated" BOOLEAN NOT NULL DEFAULT true,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Index_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Index_slug_key" ON "Index"("slug");
CREATE INDEX "Index_category_idx" ON "Index"("category");

CREATE TABLE "IndexConstituent" (
  "id" TEXT NOT NULL,
  "indexId" TEXT NOT NULL,
  "stockTokenId" TEXT NOT NULL,
  "targetWeightBps" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IndexConstituent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IndexConstituent_indexId_stockTokenId_key" ON "IndexConstituent"("indexId", "stockTokenId");
CREATE INDEX "IndexConstituent_stockTokenId_idx" ON "IndexConstituent"("stockTokenId");

CREATE TABLE "IndexNavSnapshot" (
  "id" TEXT NOT NULL,
  "indexId" TEXT NOT NULL,
  "level" DOUBLE PRECISION NOT NULL,
  "navUsd" DOUBLE PRECISION NOT NULL,
  "divisor" DOUBLE PRECISION NOT NULL,
  "takenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IndexNavSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IndexNavSnapshot_indexId_takenAt_key" ON "IndexNavSnapshot"("indexId", "takenAt");
CREATE INDEX "IndexNavSnapshot_indexId_takenAt_idx" ON "IndexNavSnapshot"("indexId", "takenAt");

ALTER TABLE "StockToken" ADD CONSTRAINT "StockToken_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "Chain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndexConstituent" ADD CONSTRAINT "IndexConstituent_indexId_fkey" FOREIGN KEY ("indexId") REFERENCES "Index"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndexConstituent" ADD CONSTRAINT "IndexConstituent_stockTokenId_fkey" FOREIGN KEY ("stockTokenId") REFERENCES "StockToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndexNavSnapshot" ADD CONSTRAINT "IndexNavSnapshot_indexId_fkey" FOREIGN KEY ("indexId") REFERENCES "Index"("id") ON DELETE CASCADE ON UPDATE CASCADE;
