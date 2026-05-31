/**
 * Backfill deep analysis for companies lacking moat/highlights/risks data.
 * Targets LEADER and CHALLENGER companies first.
 *
 * Usage: npx tsx scripts/backfill-deep-analysis.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env.local"), override: true });

const execFileAsync = promisify(execFile);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const DeepAnalysisSchema = z.object({
  companyName: z.string(),
  financials: z.object({
    marketCap: z.string().optional(),
    revenue: z.string().optional(),
    revenueGrowth: z.string().optional(),
    grossMargin: z.string().optional(),
    netMargin: z.string().optional(),
    roe: z.string().optional(),
  }),
  competitive: z.object({
    moat: z.string().optional(),
    competitors: z.array(z.string()).default([]),
  }),
  investment: z.object({
    highlights: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    analystRating: z.string().optional(),
    customerConcentration: z.string().optional(),
  }),
});

const EXAMPLE = JSON.stringify({
  companyName: "公司名称",
  financials: { marketCap: "1000亿", revenue: "500亿", revenueGrowth: "25%", grossMargin: "60%", netMargin: "30%", roe: "25%" },
  competitive: { moat: "护城河分析", competitors: ["对手1", "对手2"] },
  investment: { highlights: ["亮点1", "亮点2", "亮点3"], risks: ["风险1", "风险2", "风险3"], analystRating: "买入", customerConcentration: "前5大客户占40%" },
}, null, 2);

async function analyzeCompany(companyName: string, industry: string, nodeName: string) {
  const prompt = `你是一位资深产业链分析师，擅长从供应链瓶颈(chokepoint)视角评估投资标的。

请对"${industry}"产业链"${nodeName}"环节中的"${companyName}"进行投研级深度分析。

分析要点：
1. 财务指标：市值、营收、增速、毛利率、净利率、ROE（估算请标注）
2. 护城河：技术壁垒、不可替代性、如果断供谁受影响最大？有替代供应商吗？
3. 投资亮点：3-5条，重点关注chokepoint属性
4. 风险提示：3-5条，包括估值、流动性、技术替代风险
5. 综合评级和客户集中度

直接输出纯JSON，格式示例：
${EXAMPLE}`;

  const { stdout } = await execFileAsync("claude", ["-p", prompt, "--output-format", "json", "--allowedTools", "mcp__fetch__fetch,WebSearch"], {
    timeout: 180_000, maxBuffer: 1024 * 1024 * 10,
  });

  const cliResponse = JSON.parse(stdout);
  let jsonStr = cliResponse.result?.trim() ?? "";
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  if (!jsonStr.startsWith("{")) {
    const s = jsonStr.indexOf("{"); const e = jsonStr.lastIndexOf("}");
    if (s !== -1 && e > s) jsonStr = jsonStr.slice(s, e + 1);
  }
  jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");

  const parsed = JSON.parse(jsonStr);
  return { data: DeepAnalysisSchema.parse(parsed), cost: cliResponse.total_cost_usd ?? 0 };
}

async function main() {
  // Get companies needing deep analysis (LEADER + CHALLENGER first)
  const companies = await db.company.findMany({
    where: {
      moat: null,
      marketPosition: { in: ["LEADER", "CHALLENGER"] },
      chainNode: { chain: { status: "COMPLETED" } },
    },
    include: { chainNode: { include: { chain: { include: { project: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n🔬 深度分析补全: ${companies.length} 家公司 (龙头+挑战者)\n`);

  let done = 0, failed = 0, totalCost = 0;
  const startTime = Date.now();

  for (const company of companies) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const industry = company.chainNode.chain.project.industry;
    const nodeName = company.chainNode.name;
    process.stdout.write(`  [${elapsed}s] ${done + 1}/${companies.length} ${company.name} (${nodeName}) ... `);
    const t1 = Date.now();

    try {
      const { data, cost } = await analyzeCompany(company.name, industry, nodeName);
      const dur = Math.round((Date.now() - t1) / 1000);
      totalCost += cost;

      await db.company.update({
        where: { id: company.id },
        data: {
          marketCap: data.financials.marketCap ?? company.marketCap,
          revenue: data.financials.revenue ?? company.revenue,
          revenueGrowth: data.financials.revenueGrowth ?? company.revenueGrowth,
          grossMargin: data.financials.grossMargin ?? company.grossMargin,
          netMargin: data.financials.netMargin ?? company.netMargin,
          roe: data.financials.roe ?? company.roe,
          moat: data.competitive.moat,
          competitors: data.competitive.competitors,
          highlights: data.investment.highlights,
          risks: data.investment.risks,
          analystRating: data.investment.analystRating,
          customerConcentration: data.investment.customerConcentration,
        },
      });

      await db.$executeRawUnsafe(`INSERT INTO "AnalysisLog" ("companyId","companyName",industry,"nodeName",status,"durationSec","costUsd") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        company.id, company.name, industry, nodeName, "success", dur, cost).catch(() => {});

      done++;
      const rating = data.investment.analystRating ?? "-";
      console.log(`✓ ${dur}s ${rating} | $${cost.toFixed(4)}`);
    } catch (err: any) {
      const dur = Math.round((Date.now() - t1) / 1000);
      failed++;
      await db.$executeRawUnsafe(`INSERT INTO "AnalysisLog" ("companyId","companyName",industry,"nodeName",status,"durationSec") VALUES ($1,$2,$3,$4,$5,$6)`,
        company.id, company.name, industry, nodeName, "failed", dur).catch(() => {});
      console.log(`✗ ${dur}s ${err.message.slice(0, 50)}`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n✅ 完成: ${done} 成功, ${failed} 失败, $${totalCost.toFixed(4)}, ${totalTime}s\n`);

  await db.$disconnect();
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
