-- Phase 4 (indexer): reorg-safety fields on BlockCheckpoint.
-- Adds the block hash at lastIndexedBlock plus a bounded ring of recent
-- (blockNumber -> blockHash) pairs used for reorg detection and the bounded
-- ancestor walk-back. Both nullable so existing rows are unaffected.
ALTER TABLE "BlockCheckpoint" ADD COLUMN "lastIndexedHash" TEXT;
ALTER TABLE "BlockCheckpoint" ADD COLUMN "recentHashes" JSONB;
