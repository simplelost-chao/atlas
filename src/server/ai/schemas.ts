import { z } from "zod";

// ─── Step 1: Chain Skeleton ───────────────────────

export const ChainSkeletonNodeSchema = z.object({
  name: z.string().describe("环节名称"),
  description: z.string().describe("环节简要描述"),
  nodeType: z
    .enum(["UPSTREAM", "MIDSTREAM", "DOWNSTREAM"])
    .describe("所处产业链位置：上游/中游/下游"),
  order: z.number().describe("排列顺序，0为最下游"),
});

export const ChainSkeletonSchema = z.object({
  industryName: z.string().describe("标准化行业名称"),
  overview: z.string().describe("行业概述，100字以内"),
  nodes: z
    .array(ChainSkeletonNodeSchema)
    .min(3)
    .min(1)
    .describe("一级产业环节列表，按行业实际结构列出所有关键环节"),
});

export type ChainSkeleton = z.infer<typeof ChainSkeletonSchema>;

// ─── Step 2: Node Expansion ──────────────────────

export const SubNodeSchema = z.object({
  name: z.string().describe("子环节名称"),
  aliases: z.array(z.string()).default([]).describe("别名：中英文、化学式、代号等，用于跨产业链去重"),
  description: z.string().describe("子环节详细描述"),
  nodeType: z
    .enum(["UPSTREAM", "MIDSTREAM", "DOWNSTREAM"])
    .describe("所处产业链位置"),
  order: z.number().describe("排列顺序"),
  profitMargin: z.string().optional().describe("该环节典型利润率"),
  marketSize: z.string().optional().describe("市场规模估算"),
  growthTrend: z.string().optional().describe("增长趋势"),
  keyDrivers: z
    .array(z.string())
    .default([])
    .describe("核心驱动因素"),
});

export const NodeExpansionSchema = z.object({
  parentNodeName: z.string().describe("父环节名称"),
  subNodes: z
    .array(SubNodeSchema)
    .min(1)
    
    .describe("子环节列表，按实际情况列出"),
});

export type NodeExpansion = z.infer<typeof NodeExpansionSchema>;

// ─── Step 3: Company Discovery ───────────────────

export const DiscoveredCompanySchema = z.object({
  name: z.string().describe("公司名称"),
  aliases: z.array(z.string()).default([]).describe("别名：中英文名、简称、曾用名，用于去重"),
  ticker: z.string().optional().describe("股票代码"),
  exchange: z.string().optional().describe("交易所"),
  isPublic: z.boolean().describe("是否上市"),
  country: z.string().optional().describe("所属国家/地区"),
  mainBusiness: z.string().describe("主营业务描述"),
  coreProducts: z
    .array(z.string())
    .default([])
    .describe("核心产品/服务列表"),
  marketPosition: z
    .enum(["LEADER", "CHALLENGER", "EMERGING", "NICHE"])
    .describe("市场地位"),
  marketShare: z.string().optional().describe("预估市场份额"),
});

export const CompanyDiscoverySchema = z.object({
  nodeName: z.string().describe("所属环节名称"),
  companies: z
    .array(DiscoveredCompanySchema)
    .min(1)
    
    .describe("代表性公司列表，按实际情况列出"),
});

export type CompanyDiscovery = z.infer<typeof CompanyDiscoverySchema>;

// ─── Step 4: Deep Analysis ──────────────────────

export const DeepAnalysisSchema = z.object({
  companyName: z.string().describe("公司名称"),
  financials: z.object({
    marketCap: z.string().optional().describe("总市值"),
    revenue: z.string().optional().describe("年营收"),
    revenueGrowth: z.string().optional().describe("营收增速"),
    grossMargin: z.string().optional().describe("毛利率"),
    netMargin: z.string().optional().describe("净利率"),
    roe: z.string().optional().describe("ROE"),
    financialTrend: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("近3-5年趋势数据 JSON"),
  }),
  competitive: z.object({
    moat: z.string().optional().describe("护城河/技术壁垒分析"),
    competitors: z
      .array(z.string())
      .default([])
      .describe("主要竞争对手"),
  }),
  investment: z.object({
    highlights: z
      .array(z.string())
      .default([])
      .describe("投资亮点，3-5条"),
    risks: z
      .array(z.string())
      .default([])
      .describe("风险提示，3-5条"),
    analystRating: z.string().optional().describe("综合评级"),
    customerConcentration: z.string().optional().describe("客户集中度分析"),
  }),
});

export type DeepAnalysis = z.infer<typeof DeepAnalysisSchema>;

// ─── Step 5: Profit Chain Analysis ───────────────

export const NodeProfitAnalysisSchema = z.object({
  nodeName: z.string().describe("环节名称"),
  profitMargin: z.string().describe("该环节典型利润率"),
  valueFlow: z.string().describe("价值如何在该环节流转"),
  profitConcentration: z
    .enum(["HIGH", "MEDIUM", "LOW"])
    .describe("利润集中程度"),
  reason: z.string().describe("利润率高低的原因分析"),
});

export const ProfitChainSchema = z.object({
  summary: z.string().describe("利润链分析总结，200字以内"),
  nodeAnalyses: z
    .array(NodeProfitAnalysisSchema)
    .min(1)
    .describe("各环节利润分析"),
  profitFlowDescription: z.string().describe("利润在产业链中的整体流向描述"),
});

export type ProfitChain = z.infer<typeof ProfitChainSchema>;
