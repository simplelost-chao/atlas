/**
 * Backfill companies for nodes that don't have any.
 * Runs in batches of 4 nodes, using Claude CLI.
 *
 * Usage: npx tsx scripts/backfill-companies.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// Load env
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local"), override: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const BATCH_SIZE = 4;

const CompanyDiscoverySchema = z.object({
  nodeName: z.string(),
  companies: z.array(z.object({
    name: z.string(),
    ticker: z.string().optional(),
    exchange: z.string().optional(),
    isPublic: z.boolean(),
    country: z.string().optional(),
    mainBusiness: z.string(),
    coreProducts: z.array(z.string()).default([]),
    marketPosition: z.enum(["LEADER", "CHALLENGER", "EMERGING", "NICHE"]),
    marketShare: z.string().optional(),
  })).min(2).max(8),
});

const EXAMPLE = JSON.stringify({
  nodeName: "所属环节名称",
  companies: [{
    name: "公司名称", ticker: "TICK", exchange: "NASDAQ", isPublic: true,
    country: "美国", mainBusiness: "主营业务", coreProducts: ["产品1"],
    marketPosition: "LEADER", marketShare: "30%",
  }],
}, null, 2);

async function discoverCompanies(industry: string, nodeName: string, nodeDesc: string) {
  const prompt = `你是一位资深产业链分析师，擅长从供应链视角挖掘投资机会。
核心方法论：最好的投资机会在"市值太小被机构跳过 + 技术太深被散户忽略"的 chokepoint 公司。

在"${industry}"产业链的"${nodeName}"环节（${nodeDesc}），请列出2-8家最具代表性的公司。

挖掘策略：
1. 龙头公司——市场份额最大的领导者
2. Chokepoint公司（最重要）——控制不可替代关键技术/材料的小公司，如果断供整个供应链出问题
3. 不要只列美股大公司，特别挖掘欧洲/日韩/中国的隐形冠军
4. 提供股票代码和交易所信息

你必须严格按照以下JSON格式输出，不要包含其他文字，直接输出纯JSON。
marketPosition只能是LEADER、CHALLENGER、EMERGING、NICHE之一。

JSON格式示例：
${EXAMPLE}`;

  const { stdout } = await execFileAsync("claude", ["-p", prompt, "--output-format", "json"], {
    timeout: 180_000,
    maxBuffer: 1024 * 1024 * 10,
  });

  const cliResponse = JSON.parse(stdout);
  const resultText: string = cliResponse.result;
  const cost = cliResponse.total_cost_usd ?? 0;

  // Extract JSON
  let jsonStr = resultText.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  if (!jsonStr.startsWith("{")) {
    const s = jsonStr.indexOf("{");
    const e = jsonStr.lastIndexOf("}");
    if (s !== -1 && e > s) jsonStr = jsonStr.slice(s, e + 1);
  }

  // Repair trailing commas
  jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");

  const parsed = JSON.parse(jsonStr);
  const validated = CompanyDiscoverySchema.parse(parsed);
  return { companies: validated.companies, cost };
}

async function main() {
  const chain = await db.industryChain.findFirst({
    orderBy: { createdAt: "desc" },
    include: { project: true },
  });

  if (!chain) {
    console.log("No chain found");
    return;
  }

  const industry = chain.project.industry;
  console.log(`\n🏭 产业链: ${industry} (chainId: ${chain.id})\n`);

  // Get nodes without companies
  const allNodes = await db.chainNode.findMany({
    where: { chainId: chain.id },
    include: { _count: { select: { companies: true } } },
    orderBy: [{ level: "asc" }, { order: "asc" }],
  });

  const emptyNodes = allNodes.filter((n) => n._count.companies === 0);
  console.log(`📊 总节点: ${allNodes.length}, 需要补全: ${emptyNodes.length}`);
  console.log(`📦 批次大小: ${BATCH_SIZE}, 总批次: ${Math.ceil(emptyNodes.length / BATCH_SIZE)}\n`);

  let totalCompanies = 0;
  let totalCost = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < emptyNodes.length; i += BATCH_SIZE) {
    const batch = emptyNodes.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(emptyNodes.length / BATCH_SIZE);

    console.log(`\n━━━ 批次 ${batchNum}/${totalBatches} ━━━`);

    for (const node of batch) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      process.stdout.write(`  [${elapsed}s] ${node.name} ... `);

      try {
        const { companies, cost } = await discoverCompanies(industry, node.name, node.description);

        // Save to DB
        for (const c of companies) {
          await db.company.create({
            data: {
              chainNodeId: node.id,
              name: c.name,
              ticker: c.ticker,
              exchange: c.exchange,
              isPublic: c.isPublic,
              country: c.country,
              mainBusiness: c.mainBusiness,
              coreProducts: c.coreProducts,
              marketPosition: c.marketPosition,
              marketShare: c.marketShare,
            },
          });
        }

        totalCompanies += companies.length;
        totalCost += cost;

        const names = companies.slice(0, 3).map((c) => c.name).join(", ");
        const more = companies.length > 3 ? ` +${companies.length - 3}` : "";
        console.log(`✓ ${companies.length}家 (${names}${more}) $${cost.toFixed(4)}`);
      } catch (err: any) {
        failed++;
        console.log(`✗ ${err.message.slice(0, 60)}`);
      }
    }

    // Batch summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const done = Math.min(i + BATCH_SIZE, emptyNodes.length);
    const pct = ((done / emptyNodes.length) * 100).toFixed(0);
    console.log(`\n  进度: ${done}/${emptyNodes.length} (${pct}%) | 公司: ${totalCompanies} | 失败: ${failed} | 开销: $${totalCost.toFixed(4)} | 耗时: ${elapsed}s`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ 完成! 总计 ${totalCompanies} 家公司, ${failed} 个失败, $${totalCost.toFixed(4)}, ${totalTime}s\n`);

  await db.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
