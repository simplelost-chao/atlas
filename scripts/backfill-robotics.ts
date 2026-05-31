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

const Schema = z.object({
  companyName: z.string(),
  financials: z.object({ marketCap: z.string().optional(), revenue: z.string().optional(), revenueGrowth: z.string().optional(), grossMargin: z.string().optional(), netMargin: z.string().optional(), roe: z.string().optional() }),
  competitive: z.object({ moat: z.string().optional(), competitors: z.array(z.string()).default([]) }),
  investment: z.object({ highlights: z.array(z.string()).default([]), risks: z.array(z.string()).default([]), analystRating: z.string().optional(), customerConcentration: z.string().optional() }),
});

const EXAMPLE = JSON.stringify({
  companyName: "公司", financials: { marketCap: "1000亿", revenue: "500亿", revenueGrowth: "25%", grossMargin: "60%", netMargin: "30%", roe: "25%" },
  competitive: { moat: "护城河", competitors: ["对手1"] },
  investment: { highlights: ["亮点1"], risks: ["风险1"], analystRating: "买入", customerConcentration: "前5大客户占40%" },
}, null, 2);

async function analyze(name: string, industry: string, node: string) {
  const prompt = `你是资深产业链分析师。请对"${industry}"产业链"${node}"环节中的"${name}"进行投研级深度分析。你必须先用WebSearch工具搜索该公司2026年最新的财务数据、市值、营收，然后基于搜索结果回答。
财务指标用最新年度数据。护城河分析不可替代性。3-5条亮点，3-5条风险。综合评级和客户集中度。
直接输出纯JSON：\n${EXAMPLE}`;
  const { stdout } = await execFileAsync("claude", ["-p", prompt, "--output-format", "json", "--allowedTools", "mcp__fetch__fetch,WebSearch"], { timeout: 300000, maxBuffer: 10*1024*1024 });
  const resp = JSON.parse(stdout);
  let j = resp.result?.trim() ?? "";
  const m = j.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (m) j = m[1].trim();
  if (!j.startsWith("{")) { const s=j.indexOf("{"), e=j.lastIndexOf("}"); if(s!==-1&&e>s) j=j.slice(s,e+1); }
  j = j.replace(/,\s*([\]}])/g, "$1");
  return { data: Schema.parse(JSON.parse(j)), cost: resp.total_cost_usd ?? 0 };
}

async function main() {
  const companies = await db.company.findMany({
    where: { moat: null, marketPosition: { in: ["LEADER","CHALLENGER"] }, chainNode: { chain: { project: { industry: "Robotics" }, status: "COMPLETED" } } },
    include: { chainNode: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n🤖 机器人深度分析: ${companies.length} 家\n`);
  let done=0, fail=0, cost=0;
  const t0 = Date.now();
  for (const c of companies) {
    const el = ((Date.now()-t0)/1000).toFixed(0);
    process.stdout.write(`  [${el}s] ${++done}/${companies.length} ${c.name} ... `);
    const t1 = Date.now();
    try {
      const { data, cost: cc } = await analyze(c.name, "Robotics", c.chainNode.name);
      const dur = Math.round((Date.now() - t1) / 1000);
      cost += cc;
      await db.company.update({ where: { id: c.id }, data: {
        marketCap: data.financials.marketCap ?? c.marketCap, revenue: data.financials.revenue ?? c.revenue,
        revenueGrowth: data.financials.revenueGrowth, grossMargin: data.financials.grossMargin,
        netMargin: data.financials.netMargin, roe: data.financials.roe,
        moat: data.competitive.moat, competitors: data.competitive.competitors,
        highlights: data.investment.highlights, risks: data.investment.risks,
        analystRating: data.investment.analystRating, customerConcentration: data.investment.customerConcentration,
      }});
      await db.$executeRawUnsafe(`INSERT INTO "AnalysisLog" ("companyId","companyName",industry,"nodeName",status,"durationSec","costUsd") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        c.id, c.name, "Robotics", c.chainNode.name, "success", dur, cc).catch(()=>{});
      console.log(`✓ ${dur}s $${cc.toFixed(4)}`);
    } catch(e:any) {
      const dur = Math.round((Date.now() - t1) / 1000);
      fail++;
      await db.$executeRawUnsafe(`INSERT INTO "AnalysisLog" ("companyId","companyName",industry,"nodeName",status,"durationSec") VALUES ($1,$2,$3,$4,$5,$6)`,
        c.id, c.name, "Robotics", c.chainNode.name, "failed", dur).catch(()=>{});
      console.log(`✗ ${dur}s ${e.message.slice(0,50)}`);
    }
  }
  console.log(`\n✅ ${done-fail}成功 ${fail}失败 $${cost.toFixed(2)} ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
  await db.$disconnect(); await pool.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
