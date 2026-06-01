/**
 * V2 Four-Round Company Discovery Algorithm
 *
 * Round 1: AI supply chain divergence (discover cross-industry chokepoints)
 * Round 2: Data-driven expansion (Yahoo Finance related companies)
 * Round 3: AI second review (fill gaps, especially non-English-world companies)
 * Round 4: Financial data backfill + auto-rank market position
 *
 * This module only defines the algorithm. It does NOT run anything.
 * Call discoverCompaniesV2() to execute the full pipeline for one chain node.
 */

import type { PrismaClient, ChainNode, Company } from "@prisma/client";
import { generateObjectViaCLI } from "./claude-cli";
import { CompanyDiscoverySchema } from "./schemas";
import { getSystemPrompt } from "./prompts";
import { normalize } from "../lib/normalize";
import {
  fetchRelatedCompanies,
  fetchQuote,
  fetchFinancials,
  toYahooSymbol,
} from "../services/market-data";
import { z } from "zod";

// Schema for Round 3 (AI review — returns only new companies not in existing list)
const SupplementaryCompanySchema = z.object({
  newCompanies: z.array(
    z.object({
      name: z.string(),
      ticker: z.string().optional(),
      exchange: z.string().optional(),
      isPublic: z.boolean(),
      country: z.string().optional(),
      mainBusiness: z.string(),
      coreProducts: z.array(z.string()).default([]),
      marketPosition: z.enum(["LEADER", "CHALLENGER", "EMERGING", "NICHE"]),
      marketShare: z.string().optional(),
      reason: z.string().describe("为什么这家公司不应该被遗漏"),
    })
  ),
});

export interface DiscoveryV2Options {
  db: PrismaClient;
  node: ChainNode;
  industry: string;
  useCLI?: boolean;
  onLog?: (round: number, message: string) => void;
}

export interface DiscoveryV2Result {
  round1Count: number;
  round2Count: number;
  round3Count: number;
  round4Count: number;
  totalCompanies: number;
  newCompanies: Company[];
}

/**
 * Round 1: AI Supply Chain Divergence
 *
 * Let AI freely discover companies from a supply-chain/chokepoint perspective.
 * This is where AI adds unique value — finding cross-industry hidden connections.
 */
async function round1_aiDiscovery(
  opts: DiscoveryV2Options
): Promise<Array<z.infer<typeof CompanyDiscoverySchema>["companies"][number]>> {
  opts.onLog?.(1, `AI 发散挖掘: ${opts.node.name}`);

  const prompt = `${getSystemPrompt()}

在"${opts.industry}"产业链的"${opts.node.name}"环节（${opts.node.description}），请列出该环节所有重要的代表性公司，数量不限。

挖掘策略：
1. 龙头公司 — 全球范围该环节的绝对领导者
2. Chokepoint 公司 — 控制不可替代关键技术/材料/工艺的公司，不一定大但断供会影响整个供应链
3. 覆盖全球 — 中国、美国、欧洲、日本、韩国、以色列、台湾的公司都要考虑
4. 包括非上市公司 — 如果一家未上市公司在该环节很重要（如 OpenAI、SpaceX），也要列出
5. 跨行业关联 — 如果一家传统行业分类不在这个领域的公司，但实际控制了这个环节的关键瓶颈，也要列出

要求：
- 优先列出上市公司，提供股票代码和交易所
- marketPosition 严格判断：全球 Top 1-2 才是 LEADER，其余是 CHALLENGER/EMERGING/NICHE`;

  const example = JSON.stringify({
    nodeName: opts.node.name,
    companies: [
      {
        name: "公司名称",
        ticker: "TICK",
        exchange: "NASDAQ",
        isPublic: true,
        country: "美国",
        mainBusiness: "主营业务",
        coreProducts: ["产品1"],
        marketPosition: "LEADER",
        marketShare: "30%",
      },
    ],
  }, null, 2);

  const fullPrompt = `${prompt}\n\n直接输出纯JSON，格式：\n${example}`;

  try {
    const { object } = await generateObjectViaCLI({
      prompt: fullPrompt,
      schema: CompanyDiscoverySchema,
    });
    opts.onLog?.(1, `发现 ${object.companies.length} 家公司`);
    return object.companies;
  } catch (e: any) {
    opts.onLog?.(1, `AI 挖掘失败: ${e.message}`);
    return [];
  }
}

/**
 * Round 2: Data-Driven Expansion
 *
 * For each company found in Round 1, use Yahoo Finance to find related companies.
 * This catches companies that AI missed but are in the same industry/competitive set.
 */
async function round2_dataExpansion(
  opts: DiscoveryV2Options,
  round1Companies: Array<{ name: string; ticker?: string; exchange?: string; isPublic: boolean }>
): Promise<Array<{ symbol: string; name: string; industry?: string }>> {
  opts.onLog?.(2, `数据关联扩展: 从 ${round1Companies.length} 家公司出发`);

  const allRelated: Array<{ symbol: string; name: string; industry?: string }> = [];
  const seenSymbols = new Set<string>();

  // Collect existing tickers to avoid duplicates
  for (const c of round1Companies) {
    if (c.ticker && c.exchange) {
      const sym = toYahooSymbol(c.ticker, c.exchange);
      if (sym) seenSymbols.add(sym.toUpperCase());
    }
  }

  // Only expand from public companies with tickers
  const expandable = round1Companies.filter((c) => c.isPublic && c.ticker && c.exchange);

  for (const company of expandable) {
    try {
      const related = await fetchRelatedCompanies(company.ticker!, company.exchange!);
      for (const r of related) {
        const sym = r.symbol.toUpperCase();
        if (!seenSymbols.has(sym)) {
          seenSymbols.add(sym);
          allRelated.push(r);
        }
      }
      // Rate limit
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch {
      // ignore individual failures
    }
  }

  opts.onLog?.(2, `发现 ${allRelated.length} 家关联公司`);
  return allRelated;
}

/**
 * Round 3: AI Second Review
 *
 * Give AI the combined list from Round 1 + 2, ask it to identify gaps.
 * Specifically targets non-English-world companies and recently emerged players.
 */
async function round3_aiReview(
  opts: DiscoveryV2Options,
  existingNames: string[]
): Promise<Array<z.infer<typeof SupplementaryCompanySchema>["newCompanies"][number]>> {
  opts.onLog?.(3, `AI 二次审视: 检查 ${existingNames.length} 家公司是否有遗漏`);

  const nameList = existingNames.slice(0, 50).join("、"); // Limit to avoid prompt too long

  const prompt = `${getSystemPrompt()}

以下是"${opts.industry}"产业链"${opts.node.name}"环节已发现的公司列表：
${nameList}

请审视这个列表，告诉我还遗漏了哪些重要公司。

特别关注：
1. 中国公司 — A 股、港股、未上市但估值高的（如智谱、DeepSeek、MiniMax 等）
2. 日韩公司 — 日本和韩国在很多细分领域有隐形冠军
3. 欧洲/以色列公司 — 容易被忽略但技术领先
4. 最近 12 个月新出现或快速崛起的公司
5. 跨行业的 chokepoint 公司 — 传统分类不在这个领域但实际控制关键瓶颈

如果列表已经很完整，返回空数组即可。每家公司说明为什么不应该被遗漏。`;

  const example = JSON.stringify({
    newCompanies: [
      {
        name: "公司名称",
        ticker: "TICK",
        exchange: "SSE",
        isPublic: true,
        country: "中国",
        mainBusiness: "主营业务",
        coreProducts: ["产品1"],
        marketPosition: "CHALLENGER",
        marketShare: "10%",
        reason: "该公司在细分领域市占率高但被主流分析忽略",
      },
    ],
  }, null, 2);

  try {
    const { object } = await generateObjectViaCLI({
      prompt: `${prompt}\n\n直接输出纯JSON，格式：\n${example}`,
      schema: SupplementaryCompanySchema,
    });
    opts.onLog?.(3, `补充发现 ${object.newCompanies.length} 家公司`);
    return object.newCompanies;
  } catch (e: any) {
    opts.onLog?.(3, `AI 审视失败: ${e.message}`);
    return [];
  }
}

/**
 * Round 4: Financial Data Backfill + Auto-Rank
 *
 * For all public companies, fetch precise financial data from Yahoo Finance.
 * Then auto-calculate market position based on real market cap within the node.
 */
async function round4_financialBackfillAndRank(
  opts: DiscoveryV2Options,
  companyIds: string[]
): Promise<void> {
  opts.onLog?.(4, `金融数据回填: ${companyIds.length} 家公司`);

  const companies = await opts.db.company.findMany({
    where: { id: { in: companyIds }, isPublic: true, ticker: { not: null } },
    select: { id: true, name: true, ticker: true, exchange: true },
  });

  // Fetch and save live data
  for (const c of companies) {
    if (!c.ticker || !c.exchange) continue;
    const symbol = toYahooSymbol(c.ticker, c.exchange);
    if (!symbol) continue;

    try {
      const [quote, fin] = await Promise.all([
        fetchQuote(c.ticker, c.exchange),
        fetchFinancials(c.ticker, c.exchange),
      ]);

      if (quote || fin) {
        await opts.db.$executeRawUnsafe(
          `UPDATE "Company" SET
            "yahooSymbol" = $1,
            "liveMarketCap" = $2,
            "liveRevenue" = $3,
            "liveGrossMargin" = $4,
            "liveNetMargin" = $5,
            "liveRoe" = $6,
            "livePeRatio" = $7,
            "liveChange" = $8,
            "liveCurrency" = $9,
            "livePrice" = $10,
            "liveUpdatedAt" = NOW()
          WHERE id = $11`,
          symbol,
          quote?.marketCap ? BigInt(Math.round(quote.marketCap)) : null,
          fin?.revenue ? BigInt(Math.round(fin.revenue)) : null,
          fin?.grossMargin ?? null,
          fin?.netMargin ?? null,
          fin?.roe ?? null,
          quote?.peRatio ?? null,
          quote?.changePercent ?? null,
          quote?.currency ?? fin?.currency ?? null,
          quote?.price ?? null,
          c.id
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch {
      // ignore individual failures
    }
  }

  // Auto-rank: within this node, rank by liveMarketCap
  await autoRankNode(opts.db, opts.node.id);
  opts.onLog?.(4, `金融数据回填 + 排名完成`);
}

/**
 * Auto-rank companies within a single node based on live market cap.
 */
async function autoRankNode(db: PrismaClient, nodeId: string): Promise<void> {
  const companies = await db.company.findMany({
    where: { chainNodeId: nodeId },
    select: { id: true, liveMarketCap: true, marketShare: true, isPublic: true },
    orderBy: { liveMarketCap: "desc" },
  });

  if (companies.length === 0) return;

  // Get market caps as numbers
  const withMcap = companies
    .filter((c) => c.liveMarketCap != null)
    .map((c) => ({ id: c.id, mcap: Number(c.liveMarketCap), marketShare: c.marketShare }));

  const medianMcap =
    withMcap.length > 0
      ? withMcap[Math.floor(withMcap.length / 2)].mcap
      : 0;

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    let position: string;

    if (c.liveMarketCap == null) {
      // No live data (private company) — keep existing or set EMERGING
      position = "EMERGING";
    } else {
      const mcap = Number(c.liveMarketCap);
      const rank = withMcap.findIndex((w) => w.id === c.id);
      const thirdMcap = withMcap.length >= 3 ? withMcap[2].mcap : 0;

      if (rank <= 1 && mcap > thirdMcap * 2) {
        position = "LEADER";
      } else if (rank <= 4) {
        position = "CHALLENGER";
      } else if (mcap < medianMcap * 0.5) {
        position = "NICHE";
      } else {
        position = "EMERGING";
      }

      // Special rule: small market cap but high market share = LEADER
      if (c.marketShare) {
        const shareNum = parseInt(c.marketShare);
        if (!isNaN(shareNum) && shareNum >= 30 && position !== "LEADER") {
          position = "LEADER";
        }
      }
    }

    await db.company.update({
      where: { id: c.id },
      data: { marketPosition: position as any },
    });
  }
}

/**
 * Main entry point: Run the full 4-round discovery for a single chain node.
 *
 * This function only ADDS new companies. It never deletes existing ones.
 */
export async function discoverCompaniesV2(
  opts: DiscoveryV2Options
): Promise<DiscoveryV2Result> {
  const newCompanies: Company[] = [];

  // Get existing companies in this node — seed normKey-based dedup sets.
  const existing = await opts.db.company.findMany({
    where: { chainNodeId: opts.node.id },
    select: { id: true, name: true, ticker: true, normKey: true },
  });
  const existingNormKeys = new Set(existing.map((c) => c.normKey || normalize(c.name)));
  const existingTickers   = new Set(
    existing.filter((c) => c.ticker).map((c) => c.ticker!.toUpperCase())
  );

  // ─── Round 1: AI Discovery ─────────────────────
  const r1 = await round1_aiDiscovery(opts);
  let r1Count = 0;

  for (const companyData of r1) {
    const normKey   = normalize(companyData.name);
    const tickerKey = companyData.ticker?.toUpperCase();
    if (existingNormKeys.has(normKey) || (tickerKey && existingTickers.has(tickerKey))) {
      continue;
    }

    const company = await opts.db.company.create({
      data: {
        chainNodeId: opts.node.id,
        name: companyData.name,
        normKey,
        aliases: (companyData as any).aliases ?? [],
        ticker: companyData.ticker,
        exchange: companyData.exchange,
        isPublic: companyData.isPublic,
        country: companyData.country,
        mainBusiness: companyData.mainBusiness,
        coreProducts: companyData.coreProducts ?? [],
        marketPosition: companyData.marketPosition,
        marketShare: companyData.marketShare,
      },
    });
    newCompanies.push(company);
    existingNormKeys.add(normKey);
    if (tickerKey) existingTickers.add(tickerKey);
    r1Count++;
  }

  // ─── Round 2: Data Expansion ───────────────────
  const r2Related = await round2_dataExpansion(opts, [
    ...r1.map((c) => ({ name: c.name, ticker: c.ticker, exchange: c.exchange, isPublic: c.isPublic })),
    ...existing.map((c) => ({ name: c.name, ticker: c.ticker ?? undefined, exchange: undefined, isPublic: true })),
  ]);

  let r2Count = 0;
  for (const related of r2Related) {
    const tickerKey = related.symbol.toUpperCase();
    if (existingTickers.has(tickerKey)) continue;

    try {
      const quote = await fetchQuote(related.symbol, "");
      if (quote && quote.marketCap && quote.marketCap > 1e8) {
        const normKey = normalize(related.name);
        const company = await opts.db.company.create({
          data: {
            chainNodeId: opts.node.id,
            name: related.name,
            normKey,
            ticker: related.symbol,
            exchange: "",
            isPublic: true,
            mainBusiness: related.industry ?? "",
            marketPosition: "EMERGING",
            yahooSymbol: related.symbol,
            liveMarketCap: BigInt(Math.round(quote.marketCap)),
            livePrice: quote.price ? new (require("@prisma/client/runtime/library").Decimal)(quote.price) : undefined,
            liveCurrency: quote.currency,
            liveUpdatedAt: new Date(),
          },
        });
        newCompanies.push(company);
        existingNormKeys.add(normKey);
        existingTickers.add(tickerKey);
        r2Count++;
      }
    } catch {
      // ignore
    }
  }

  // ─── Round 3: AI Review ────────────────────────
  const existingNamesForPrompt = existing.map((c) => c.name);
  const r3 = await round3_aiReview(opts, existingNamesForPrompt);
  let r3Count = 0;

  for (const companyData of r3) {
    const normKey   = normalize(companyData.name);
    const tickerKey = companyData.ticker?.toUpperCase();
    if (existingNormKeys.has(normKey) || (tickerKey && existingTickers.has(tickerKey))) {
      continue;
    }

    const company = await opts.db.company.create({
      data: {
        chainNodeId: opts.node.id,
        name: companyData.name,
        normKey,
        aliases: (companyData as any).aliases ?? [],
        ticker: companyData.ticker,
        exchange: companyData.exchange,
        isPublic: companyData.isPublic,
        country: companyData.country,
        mainBusiness: companyData.mainBusiness,
        coreProducts: companyData.coreProducts ?? [],
        marketPosition: companyData.marketPosition,
        marketShare: companyData.marketShare,
      },
    });
    newCompanies.push(company);
    existingNormKeys.add(normKey);
    if (tickerKey) existingTickers.add(tickerKey);
    r3Count++;
  }

  // ─── Round 4: Financial Backfill + Rank ────────
  const allCompanyIds = [
    ...existing.map((c) => c.id),
    ...newCompanies.map((c) => c.id),
  ];
  await round4_financialBackfillAndRank(opts, allCompanyIds);

  return {
    round1Count: r1Count,
    round2Count: r2Count,
    round3Count: r3Count,
    round4Count: allCompanyIds.length,
    totalCompanies: existing.length + newCompanies.length,
    newCompanies,
  };
}

/**
 * Run auto-rank for all nodes in a chain.
 * Call this after syncing market data to recalculate positions.
 */
export async function autoRankChain(
  db: PrismaClient,
  chainId: string
): Promise<void> {
  const nodes = await db.chainNode.findMany({
    where: { chainId },
    select: { id: true },
  });

  for (const node of nodes) {
    await autoRankNode(db, node.id);
  }
}
