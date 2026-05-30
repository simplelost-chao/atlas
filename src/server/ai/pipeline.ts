import { generateObject } from "ai";
import type { PrismaClient } from "@prisma/client";
import type { ChainNode, Company } from "@prisma/client";
import { LLMRouter } from "./llm-router";
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

export interface PipelineContext {
  db: PrismaClient;
  router: LLMRouter;
  chainId: string;
  industry: string;
  maxDepth: number;
  onProgress?: (step: number, message: string) => void;
}

/** Concurrency limiter for parallel LLM calls. */
async function parallelWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const p = fn(item).then((result) => {
      results.push(result);
    });
    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove resolved promises
      for (let i = executing.length - 1; i >= 0; i--) {
        // Check if settled by trying to race with an already-resolved promise
        const settled = await Promise.race([
          executing[i].then(() => true),
          Promise.resolve(false),
        ]);
        if (settled) executing.splice(i, 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}

// ─── Step 1: Skeleton ─────────────────────────────

export async function runSkeletonStep(
  ctx: PipelineContext
): Promise<ChainNode[]> {
  ctx.onProgress?.(1, "正在生成产业链骨架...");

  const { object } = await generateObject({
    model: ctx.router.getModelForStep("skeleton"),
    system: getSystemPrompt(),
    prompt: skeletonPrompt(ctx.industry),
    schema: ChainSkeletonSchema,
  });

  const nodes: ChainNode[] = [];
  for (const nodeData of object.nodes) {
    const node = await ctx.db.chainNode.create({
      data: {
        chainId: ctx.chainId,
        name: nodeData.name,
        description: nodeData.description,
        nodeType: nodeData.nodeType,
        level: 0,
        order: nodeData.order,
      },
    });
    nodes.push(node);
  }

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

  const { object } = await generateObject({
    model: ctx.router.getModelForStep("nodeExpansion"),
    system: getSystemPrompt(),
    prompt: nodeExpansionPrompt(
      ctx.industry,
      parentNode.name,
      parentNode.description,
      parentNode.level + 1
    ),
    schema: NodeExpansionSchema,
  });

  const children: ChainNode[] = [];
  for (const subNode of object.subNodes) {
    const node = await ctx.db.chainNode.create({
      data: {
        chainId: ctx.chainId,
        parentId: parentNode.id,
        name: subNode.name,
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

  // Expand nodes in parallel with concurrency limit
  await parallelWithLimit(nodes, 3, async (node) => {
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

  const { object } = await generateObject({
    model: ctx.router.getModelForStep("companyDiscovery"),
    system: getSystemPrompt(),
    prompt: companyDiscoveryPrompt(ctx.industry, node.name, node.description),
    schema: CompanyDiscoverySchema,
  });

  const companies: Company[] = [];
  for (const companyData of object.companies) {
    const company = await ctx.db.company.create({
      data: {
        chainNodeId: node.id,
        name: companyData.name,
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

  return companies;
}

// ─── Step 4: Deep Analysis ────────────────────────

export async function runDeepAnalysisStep(
  ctx: PipelineContext,
  company: Company,
  nodeName: string
): Promise<void> {
  ctx.onProgress?.(4, `正在深度分析: ${company.name}...`);

  const { object } = await generateObject({
    model: ctx.router.getModelForStep("deepAnalysis"),
    system: getSystemPrompt(),
    prompt: deepAnalysisPrompt(company.name, ctx.industry, nodeName),
    schema: DeepAnalysisSchema,
  });

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

  const { object } = await generateObject({
    model: ctx.router.getModelForStep("profitChain"),
    system: getSystemPrompt(),
    prompt: profitChainPrompt(ctx.industry, nodeInfos),
    schema: ProfitChainSchema,
  });

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
}

// ─── Full Pipeline ────────────────────────────────

export async function runFullPipeline(ctx: PipelineContext): Promise<void> {
  try {
    // Update status to GENERATING
    await ctx.db.industryChain.update({
      where: { id: ctx.chainId },
      data: { status: "GENERATING" },
    });

    // Step 1: Generate skeleton
    const rootNodes = await runSkeletonStep(ctx);

    // Step 2: Expand all nodes recursively
    await expandAllNodes(ctx, rootNodes);

    // Step 3: Discover companies for leaf nodes
    const allNodes = await ctx.db.chainNode.findMany({
      where: { chainId: ctx.chainId },
      include: { children: { select: { id: true } } },
    });
    const leafNodes = allNodes.filter((n) => n.children.length === 0);

    const allCompanies: Array<{ company: Company; nodeName: string }> = [];
    await parallelWithLimit(leafNodes, 3, async (node) => {
      const companies = await runCompanyDiscoveryStep(ctx, node);
      for (const c of companies) {
        allCompanies.push({ company: c, nodeName: node.name });
      }
    });

    // Step 4: Deep analysis for LEADER and CHALLENGER companies
    const priorityCompanies = allCompanies.filter(
      ({ company }) =>
        company.marketPosition === "LEADER" ||
        company.marketPosition === "CHALLENGER"
    );

    await parallelWithLimit(priorityCompanies, 2, async ({ company, nodeName }) => {
      await runDeepAnalysisStep(ctx, company, nodeName);
    });

    // Step 5: Profit chain analysis
    await runProfitChainStep(ctx);

    // Update status to COMPLETED
    await ctx.db.industryChain.update({
      where: { id: ctx.chainId },
      data: { status: "COMPLETED" },
    });

    ctx.onProgress?.(5, "产业链生成完成！");
  } catch (error) {
    // Update status to FAILED
    await ctx.db.industryChain.update({
      where: { id: ctx.chainId },
      data: { status: "FAILED" },
    });
    throw error;
  }
}
