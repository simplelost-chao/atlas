/**
 * Run the full pipeline for a specific chain.
 * Usage: npx tsx scripts/run-pipeline.ts <chainId> <industry>
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local"), override: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  const chainId = process.argv[2];
  const industry = process.argv[3];

  if (!chainId || !industry) {
    console.error("Usage: npx tsx scripts/run-pipeline.ts <chainId> <industry>");
    process.exit(1);
  }

  console.log(`\n🚀 Starting pipeline for "${industry}" (chain: ${chainId})\n`);

  // Dynamic import to use the project's pipeline code
  const { runFullPipeline } = await import("../src/server/ai/pipeline");
  const { LLMRouter } = await import("../src/server/ai/llm-router");

  const router = new LLMRouter({
    defaultProvider: "anthropic",
    providers: { anthropic: { apiKey: "cli-mode", model: "cli" } },
  });

  await runFullPipeline({
    db: db as any,
    router,
    chainId,
    industry,
    maxDepth: 2,
    useCLI: true,
    onProgress: (step, msg) => console.log(`[Step ${step}] ${msg}`),
  });

  console.log("\n✅ Pipeline complete!\n");
  await db.$disconnect();
  await pool.end();
}

main().catch(async (e) => {
  console.error("Pipeline failed:", e.message);
  // Mark chain as failed
  const chainId = process.argv[2];
  if (chainId) {
    await db.$executeRawUnsafe(
      `UPDATE "IndustryChain" SET status = 'FAILED' WHERE id = $1`,
      chainId
    );
  }
  await db.$disconnect();
  await pool.end();
  process.exit(1);
});
