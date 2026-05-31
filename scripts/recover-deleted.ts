import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: "/Users/chao/Documents/Projects/atlas/.env" });
dotenv.config({ path: "/Users/chao/Documents/Projects/atlas/.env.local", override: true });

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

async function main() {
  const companies = await (db as any).$queryRaw`
    SELECT c.id, c.name, c."marketPosition", cn.name as "nodeName", p.industry
    FROM "Company" c
    JOIN "ChainNode" cn ON cn.id = c."chainNodeId"
    JOIN "IndustryChain" ic ON ic.id = cn."chainId"
    JOIN "Project" p ON p.id = ic."projectId"
    WHERE c.moat IS NULL AND c."isPublic" = true AND c."marketCap" IS NULL AND c.highlights = '{}'
    AND c.id IN (SELECT "companyId" FROM "AnalysisLog" WHERE status = 'success')
  `;
  
  console.log(`\n🔧 恢复 ${companies.length} 家被误删的公司数据\n`);
  
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i] as any;
    process.stdout.write(`  ${i+1}/${companies.length} ${c.name} ... `);
    try {
      const prompt = `你是资深产业链分析师。请对"${c.industry}"产业链"${c.nodeName}"环节中的"${c.name}"进行投研级深度分析。你必须先用WebSearch工具搜索该公司2026年最新的财务数据、市值、营收，然后基于搜索结果回答。
财务指标用最新年度数据。护城河分析不可替代性。3-5条亮点，3-5条风险。综合评级和客户集中度。
直接输出纯JSON：\n${EXAMPLE}`;
      const { stdout } = await execFileAsync("claude", ["-p", prompt, "--output-format", "json", "--allowedTools", "mcp__fetch__fetch,WebSearch"], { timeout: 300000, maxBuffer: 10*1024*1024 });
      const resp = JSON.parse(stdout);
      let j = resp.result?.trim() ?? "";
      const m = j.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (m) j = m[1].trim();
      if (!j.startsWith("{")) { const s=j.indexOf("{"), e=j.lastIndexOf("}"); if(s!==-1&&e>s) j=j.slice(s,e+1); }
      j = j.replace(/,\s*([\]}])/g, "$1");
      const data = Schema.parse(JSON.parse(j));
      
      await db.company.update({ where: { id: c.id }, data: {
        marketCap: data.financials.marketCap, revenue: data.financials.revenue,
        revenueGrowth: data.financials.revenueGrowth, grossMargin: data.financials.grossMargin,
        netMargin: data.financials.netMargin, roe: data.financials.roe,
        moat: data.competitive.moat, competitors: data.competitive.competitors,
        highlights: data.investment.highlights, risks: data.investment.risks,
        analystRating: data.investment.analystRating, customerConcentration: data.investment.customerConcentration,
      }});
      console.log(`✓`);
    } catch(e:any) {
      console.log(`✗ ${e.message.slice(0,50)}`);
    }
  }
  console.log(`\n✅ 恢复完成\n`);
  await db.$disconnect(); await pool.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
