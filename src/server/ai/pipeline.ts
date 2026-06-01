import { generateObject } from "ai";
import type { PrismaClient } from "@prisma/client";
import type { ChainNode, Company } from "@prisma/client";
import { LLMRouter } from "./llm-router";
import { generateObjectViaCLI } from "./claude-cli";
import {
  ChainSkeletonSchema,
  NodeExpansionSchema,
  CompanyDiscoverySchema,
  DeepAnalysisSchema,
  ProfitChainSchema,
} from "./schemas";
import {
  getSystemPrompt,
  skeletonPrompt,
  nodeExpansionPrompt,
  companyDiscoveryPrompt,
  deepAnalysisPrompt,
  profitChainPrompt,
} from "./prompts";
import { normalize } from "../lib/normalize";
import { findNodeByName, findCompanyByTickerOrName } from "../services/entity-resolution";

export interface PipelineContext {
  db: PrismaClient;
  router: LLMRouter;
  chainId: string;
  industry: string;
  maxDepth: number;
  useCLI?: boolean;
  onProgress?: (step: number, message: string) => void;
}

/** Append a log entry to the chain's logs array in DB */
async function appendLog(
  ctx: PipelineContext,
  log: { step: number; stepName: string; message: string; costUSD?: number; durationMs?: number; detail?: string }
) {
  const entry = { ...log, timestamp: new Date().toISOString() };
  console.log(`[Pipeline] Step ${log.step} (${log.stepName}): ${log.message}`);
  try {
    await ctx.db.$executeRawUnsafe(
      `UPDATE "IndustryChain" SET "logs" = "logs" || $1::jsonb, "updatedAt" = NOW() WHERE "id" = $2`,
      JSON.stringify(entry),
      ctx.chainId
    );
  } catch (e) {
    console.error("[Pipeline] Failed to append log:", e);
  }
}

/** Unified generate function: uses Claude CLI or Vercel AI SDK */
async function generate<T extends import("zod").ZodType>(
  ctx: PipelineContext,
  step: import("./llm-router").PipelineStep,
  stepNum: number,
  stepName: string,
  opts: { system?: string; prompt: string; schema: T },
  detail?: string
): Promise<{ object: import("zod").infer<T> }> {
  const startTime = Date.now();
  await appendLog(ctx, { step: stepNum, stepName, message: `开始: ${detail ?? stepName}...` });

  let result: any;
  if (ctx.useCLI) {
    result = await generateObjectViaCLI(opts);
  } else {
    result = await generateObject({
      model: ctx.router.getModelForStep(step),
      system: opts.system,
      prompt: opts.prompt,
      schema: opts.schema,
    });
  }

  const elapsed = Date.now() - startTime;
  await appendLog(ctx, {
    step: stepNum,
    stepName,
    message: `完成: ${detail ?? stepName}`,
    costUSD: result.costUSD,
    durationMs: elapsed,
    detail,
  });

  return result;
}

/** Concurrency limiter for parallel LLM calls. */
async function parallelWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  // Sequential mode
  if (limit <= 1) {
    const results: R[] = [];
    for (const item of items) {
      results.push(await fn(item));
    }
    return results;
  }

  // Parallel with concurrency limit
  const results: R[] = [];
  let i = 0;
  async function runNext(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      const result = await fn(items[idx]);
      results.push(result);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

// ─── Step 1: Skeleton ─────────────────────────────

export async function runSkeletonStep(
  ctx: PipelineContext
): Promise<ChainNode[]> {
  ctx.onProgress?.(1, "正在生成产业链骨架...");

  const { object } = await generate(ctx, "skeleton", 1, "骨架生成", {
    system: getSystemPrompt(),
    prompt: skeletonPrompt(ctx.industry),
    schema: ChainSkeletonSchema,
  }, `生成 ${ctx.industry} 产业链骨架`);

  const nodes: ChainNode[] = [];
  for (const nodeData of object.nodes) {
    const node = await ctx.db.chainNode.create({
      data: {
        chainId: ctx.chainId,
        name: nodeData.name,
        normKey: normalize(nodeData.name),
        description: nodeData.description,
        nodeType: nodeData.nodeType,
        level: 0,
        order: nodeData.order,
      },
    });
    nodes.push(node);
  }

  // Log skeleton structure
  const nodeList = nodes.map(n => `  ${n.nodeType === 'UPSTREAM' ? '🔴' : n.nodeType === 'DOWNSTREAM' ? '🟢' : '🟡'} ${n.name}`).join('\n');
  await appendLog(ctx, {
    step: 1, stepName: "骨架结构",
    message: `产业链骨架 ${nodes.length} 个环节:\n${nodeList}`,
  });

  ctx.onProgress?.(1, `骨架生成完成，共 ${nodes.length} 个一级环节`);
  return nodes;
}

// ─── Step 2: Node Expansion ───────────────────────

export async function runNodeExpansionStep(
  ctx: PipelineContext,
  parentNode: ChainNode
): Promise<ChainNode[]> {
  if (parentNode.level >= ctx.maxDepth - 1) {
    return []; // Max depth reached
  }

  ctx.onProgress?.(
    2,
    `正在拆解环节: ${parentNode.name} (层级 ${parentNode.level})...`
  );

  const { object } = await generate(ctx, "nodeExpansion", 2, "环节细化", {
    system: getSystemPrompt(),
    prompt: nodeExpansionPrompt(
      ctx.industry,
      parentNode.name,
      parentNode.description,
      parentNode.level + 1
    ),
    schema: NodeExpansionSchema,
  }, `拆解「${parentNode.name}」`);

  const children: ChainNode[] = [];
  for (const subNode of object.subNodes) {
    // Entity resolution: skip if an equivalent node already exists in this chain.
    const existing = await findNodeByName(ctx.db, ctx.chainId, subNode.name);
    if (existing) continue;

    const node = await ctx.db.chainNode.create({
      data: {
        chainId: ctx.chainId,
        parentId: parentNode.id,
        name: subNode.name,
        normKey: normalize(subNode.name),
        aliases: (subNode as any).aliases ?? [],
        description: subNode.description,
        nodeType: subNode.nodeType,
        level: parentNode.level + 1,
        order: subNode.order,
        profitMargin: subNode.profitMargin,
        marketSize: subNode.marketSize,
        growthTrend: subNode.growthTrend,
        keyDrivers: subNode.keyDrivers ?? [],
      },
    });
    children.push(node);
  }

  return children;
}

/**
 * Recursively expand all nodes up to maxDepth.
 */
async function expandAllNodes(
  ctx: PipelineContext,
  nodes: ChainNode[]
): Promise<void> {
  if (nodes.length === 0) return;
  if (nodes[0].level >= ctx.maxDepth - 1) return;

  const allChildren: ChainNode[] = [];

  // Expand nodes (sequential in CLI mode, parallel otherwise)
  await parallelWithLimit(nodes, ctx.useCLI ? 1 : 3, async (node) => {
    const children = await runNodeExpansionStep(ctx, node);
    allChildren.push(...children);
  });

  // Recursively expand children
  await expandAllNodes(ctx, allChildren);
}

// ─── Step 3: Company Discovery ────────────────────

export async function runCompanyDiscoveryStep(
  ctx: PipelineContext,
  node: ChainNode
): Promise<Company[]> {
  ctx.onProgress?.(3, `正在挖掘公司: ${node.name}...`);

  const { object } = await generate(ctx, "companyDiscovery", 3, "公司挖掘", {
    system: getSystemPrompt(),
    prompt: companyDiscoveryPrompt(ctx.industry, node.name, node.description),
    schema: CompanyDiscoverySchema,
  }, `挖掘「${node.name}」环节公司`);

  const companies: Company[] = [];
  for (const companyData of object.companies) {
    // Entity resolution: skip if this company already exists under this node.
    const normKey = normalize(companyData.name);
    const dup = await ctx.db.company.findFirst({
      where: {
        chainNodeId: node.id,
        OR: [
          { normKey },
          ...(companyData.ticker
            ? [{ ticker: { equals: companyData.ticker, mode: "insensitive" as const } }]
            : []),
        ],
      },
      select: { id: true },
    });
    if (dup) continue;

    const company = await ctx.db.company.create({
      data: {
        chainNodeId: node.id,
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
    companies.push(company);
  }

  // Log discovered companies
  const posLabel: Record<string, string> = { LEADER: '龙头', CHALLENGER: '挑战者', EMERGING: '新兴', NICHE: '细分' };
  const companyList = companies.map(c => {
    const tag = posLabel[c.marketPosition] ?? c.marketPosition;
    const ticker = c.ticker ? ` (${c.ticker})` : '';
    const share = c.marketShare ? ` 份额${c.marketShare}` : '';
    return `  [${tag}] ${c.name}${ticker}${share}`;
  }).join('\n');
  await appendLog(ctx, {
    step: 3, stepName: "发现公司",
    message: `「${node.name}」发现 ${companies.length} 家公司:\n${companyList}`,
  });

  return companies;
}

// ─── Step 4: Deep Analysis ────────────────────────

export async function runDeepAnalysisStep(
  ctx: PipelineContext,
  company: Company,
  nodeName: string
): Promise<void> {
  ctx.onProgress?.(4, `正在深度分析: ${company.name}...`);

  const { object } = await generate(ctx, "deepAnalysis", 4, "深度分析", {
    system: getSystemPrompt(),
    prompt: deepAnalysisPrompt(company.name, ctx.industry, nodeName),
    schema: DeepAnalysisSchema,
  }, `深度分析「${company.name}」`);

  await ctx.db.company.update({
    where: { id: company.id },
    data: {
      marketCap: object.financials.marketCap,
      revenue: object.financials.revenue,
      revenueGrowth: object.financials.revenueGrowth,
      grossMargin: object.financials.grossMargin,
      netMargin: object.financials.netMargin,
      roe: object.financials.roe,
      financialTrend: object.financials.financialTrend as any,
      moat: object.competitive.moat,
      competitors: object.competitive.competitors ?? [],
      highlights: object.investment.highlights ?? [],
      risks: object.investment.risks ?? [],
      analystRating: object.investment.analystRating,
      customerConcentration: object.investment.customerConcentration,
    },
  });

  // Log deep analysis results
  const f = object.financials;
  const inv = object.investment;
  const lines = [
    `  📊 ${company.name} (${nodeName})`,
    f.marketCap ? `  市值: ${f.marketCap}` : null,
    f.revenue ? `  营收: ${f.revenue}${f.revenueGrowth ? ` (增速${f.revenueGrowth})` : ''}` : null,
    f.grossMargin ? `  毛利率: ${f.grossMargin} | 净利率: ${f.netMargin ?? '-'}` : null,
    object.competitive.moat ? `  护城河: ${object.competitive.moat.slice(0, 60)}` : null,
    inv.analystRating ? `  评级: ${inv.analystRating}` : null,
    inv.highlights?.length ? `  亮点: ${inv.highlights.slice(0, 2).join('；')}` : null,
    inv.risks?.length ? `  风险: ${inv.risks.slice(0, 2).join('；')}` : null,
  ].filter(Boolean).join('\n');
  await appendLog(ctx, {
    step: 4, stepName: "投研分析",
    message: lines,
  });
}

// ─── Step 5: Profit Chain ─────────────────────────

export async function runProfitChainStep(
  ctx: PipelineContext
): Promise<void> {
  ctx.onProgress?.(5, "正在分析利润链...");

  const allNodes = await ctx.db.chainNode.findMany({
    where: { chainId: ctx.chainId },
    orderBy: { level: "asc" },
  });

  const nodeInfos = allNodes.map((n) => ({
    name: n.name,
    description: n.description,
    nodeType: n.nodeType,
  }));

  const { object } = await generate(ctx, "profitChain", 5, "利润链分析", {
    system: getSystemPrompt(),
    prompt: profitChainPrompt(ctx.industry, nodeInfos),
    schema: ProfitChainSchema,
  }, `分析 ${ctx.industry} 产业利润链`);

  // Update nodes with profit chain analysis
  for (const analysis of object.nodeAnalyses) {
    const matchingNode = allNodes.find((n) => n.name === analysis.nodeName);
    if (matchingNode) {
      await ctx.db.chainNode.update({
        where: { id: matchingNode.id },
        data: {
          profitMargin: analysis.profitMargin,
          valueFlow: analysis.valueFlow,
        },
      });
    }
  }

  // Log profit chain summary
  const concLabel: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' };
  const profitLines = object.nodeAnalyses.map(a =>
    `  ${a.nodeName}: 利润率 ${a.profitMargin} (集中度:${concLabel[a.profitConcentration] ?? a.profitConcentration})`
  ).join('\n');
  await appendLog(ctx, {
    step: 5, stepName: "利润链",
    message: `${object.summary}\n${profitLines}\n\n${object.profitFlowDescription}`,
  });
}

// ─── Full Pipeline ────────────────────────────────

export async function runFullPipeline(ctx: PipelineContext): Promise<void> {
  const pipelineStart = Date.now();
  try {
    // Update status to GENERATING, clear old logs
    await ctx.db.industryChain.update({
      where: { id: ctx.chainId },
      data: { status: "GENERATING", logs: [] },
    });

    await appendLog(ctx, { step: 0, stepName: "初始化", message: `开始生成「${ctx.industry}」产业链，最大深度 ${ctx.maxDepth}` });

    // Step 1: Generate skeleton
    const rootNodes = await runSkeletonStep(ctx);

    // Step 2: Expand all nodes recursively
    await expandAllNodes(ctx, rootNodes);

    // Step 3: Discover companies for ALL nodes (not just leaves)
    const allNodes = await ctx.db.chainNode.findMany({
      where: { chainId: ctx.chainId },
    });

    await appendLog(ctx, { step: 3, stepName: "公司挖掘", message: `开始挖掘 ${allNodes.length} 个环节的公司...` });

    const allCompanies: Array<{ company: Company; nodeName: string }> = [];
    await parallelWithLimit(allNodes, ctx.useCLI ? 1 : 3, async (node) => {
      const companies = await runCompanyDiscoveryStep(ctx, node);
      for (const c of companies) {
        allCompanies.push({ company: c, nodeName: node.name });
      }
    });

    await appendLog(ctx, { step: 3, stepName: "公司挖掘", message: `共发现 ${allCompanies.length} 家公司` });

    // Step 4: Deep analysis for LEADER and CHALLENGER companies (max 10)
    const priorityCompanies = allCompanies
      .filter(
        ({ company }) =>
          company.marketPosition === "LEADER" ||
          company.marketPosition === "CHALLENGER"
      )
      .slice(0, 10);

    await appendLog(ctx, { step: 4, stepName: "深度分析", message: `对 ${priorityCompanies.length} 家重点公司进行投研分析...` });

    await parallelWithLimit(priorityCompanies, ctx.useCLI ? 1 : 2, async ({ company, nodeName }) => {
      await runDeepAnalysisStep(ctx, company, nodeName);
    });

    // Step 5: Profit chain analysis
    await runProfitChainStep(ctx);

    const totalTime = ((Date.now() - pipelineStart) / 1000).toFixed(1);
    await appendLog(ctx, { step: 5, stepName: "完成", message: `产业链生成完成！总耗时 ${totalTime}s` });

    // Update status to COMPLETED
    await ctx.db.industryChain.update({
      where: { id: ctx.chainId },
      data: { status: "COMPLETED" },
    });

    ctx.onProgress?.(5, "产业链生成完成！");
  } catch (error: any) {
    // Check if we have meaningful data despite the error
    const nodeCount = await ctx.db.chainNode.count({ where: { chainId: ctx.chainId } });
    const companyCount = await ctx.db.company.count({ where: { chainNode: { chainId: ctx.chainId } } });

    if (nodeCount > 0 && companyCount > 0) {
      // Data exists — mark as completed, just log the error
      await appendLog(ctx, { step: -1, stepName: "警告", message: `部分步骤失败但数据已保存: ${error.message}` });
      await ctx.db.industryChain.update({
        where: { id: ctx.chainId },
        data: { status: "COMPLETED" },
      });
    } else {
      await appendLog(ctx, { step: -1, stepName: "错误", message: `生成失败: ${error.message}` });
      await ctx.db.industryChain.update({
        where: { id: ctx.chainId },
        data: { status: "FAILED" },
      });
      throw error;
    }
  }
}
