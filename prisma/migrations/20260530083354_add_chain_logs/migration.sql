-- AlterTable
ALTER TABLE "IndustryChain" ADD COLUMN     "logs" JSONB[] DEFAULT ARRAY[]::JSONB[];
