-- Migration: add Python CLI sync fields to ChainNode + new ChainEdge table
-- Safe to run on existing data: all new columns have defaults, no existing
-- columns are dropped or renamed.

-- Enums
CREATE TYPE "NodeSyncStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'REJECTED');
CREATE TYPE "NodeSyncSource" AS ENUM ('ATLAS_PIPELINE', 'PYTHON_CLI');

-- ChainNode: add sync metadata fields
ALTER TABLE "ChainNode"
  ADD COLUMN IF NOT EXISTS "syncStatus"      "NodeSyncStatus" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN IF NOT EXISTS "syncSource"      "NodeSyncSource" NOT NULL DEFAULT 'ATLAS_PIPELINE',
  ADD COLUMN IF NOT EXISTS "evidenceGrade"   TEXT,
  ADD COLUMN IF NOT EXISTS "bottleneckLayer" TEXT,
  ADD COLUMN IF NOT EXISTS "themeIds"        TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "ChainNode_syncStatus_idx" ON "ChainNode"("syncStatus");

-- ChainEdge: explicit DAG edges from Python CLI (separate from parentId tree)
CREATE TABLE IF NOT EXISTS "ChainEdge" (
    "id"           TEXT NOT NULL,
    "upstreamId"   TEXT NOT NULL,
    "downstreamId" TEXT NOT NULL,
    "rationale"    TEXT NOT NULL DEFAULT '',
    "chainId"      TEXT NOT NULL,
    "syncSource"   "NodeSyncSource" NOT NULL DEFAULT 'PYTHON_CLI',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEdge_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChainEdge"
  ADD CONSTRAINT "ChainEdge_upstreamId_fkey"
    FOREIGN KEY ("upstreamId") REFERENCES "ChainNode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChainEdge_downstreamId_fkey"
    FOREIGN KEY ("downstreamId") REFERENCES "ChainNode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChainEdge_chainId_fkey"
    FOREIGN KEY ("chainId") REFERENCES "IndustryChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "ChainEdge_upstreamId_downstreamId_chainId_key"
  ON "ChainEdge"("upstreamId", "downstreamId", "chainId");
CREATE INDEX IF NOT EXISTS "ChainEdge_chainId_idx"      ON "ChainEdge"("chainId");
CREATE INDEX IF NOT EXISTS "ChainEdge_upstreamId_idx"   ON "ChainEdge"("upstreamId");
CREATE INDEX IF NOT EXISTS "ChainEdge_downstreamId_idx" ON "ChainEdge"("downstreamId");
