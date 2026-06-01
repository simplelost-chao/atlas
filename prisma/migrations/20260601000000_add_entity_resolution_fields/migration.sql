-- Migration: add entity-resolution fields to ChainNode and Company
--
-- Adds `aliases` (string array for alternate names/codes) and `normKey`
-- (pre-computed normalized match key) to both models.
-- Both default to empty/blank so existing rows are unaffected.
-- After applying: run `npx tsx scripts/backfill-normkey.ts` once.

-- ChainNode
ALTER TABLE "ChainNode" ADD COLUMN IF NOT EXISTS "aliases"  TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE "ChainNode" ADD COLUMN IF NOT EXISTS "normKey"  TEXT    NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "ChainNode_chainId_normKey_idx" ON "ChainNode"("chainId", "normKey");

-- Company
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "aliases"  TEXT[]  NOT NULL DEFAULT '{}';
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "normKey"  TEXT    NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "Company_ticker_idx"   ON "Company"("ticker");
CREATE INDEX IF NOT EXISTS "Company_normKey_idx"  ON "Company"("normKey");
