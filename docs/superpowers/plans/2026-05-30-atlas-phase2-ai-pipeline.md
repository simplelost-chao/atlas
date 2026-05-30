# Atlas Phase 2: AI Generation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 5-step AI generation pipeline that takes an industry keyword and produces a complete industry chain with nodes, companies, financial analysis, and profit chain insights — all stored in the database and visible on the project page.

**Architecture:** Vercel AI SDK with an LLM Router abstraction layer. Each pipeline step uses `generateObject()` with Zod schemas for structured output. Steps run sequentially (1→2→3→4→5), but within Steps 2 and 3, individual nodes are expanded in parallel with controlled concurrency. Pipeline state is stored in the `IndustryChain.status` field and progress is polled via tRPC.

**Tech Stack:** Vercel AI SDK (`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic`), zod v4, tRPC v11, Prisma v7 (with `@prisma/adapter-pg`), Next.js 16

---

## File Structure

```
atlas/
├── src/
│   ├── server/
│   │   ├── ai/
│   │   │   ├── llm-router.ts            (LLM Router abstraction)
│   │   │   ├── schemas.ts               (Zod schemas for structured LLM output)
│   │   │   ├── prompts.ts               (Prompt templates for each step)
│   │   │   └── pipeline.ts              (5-step generation pipeline orchestrator)
│   │   └── trpc/
│   │       └── routers/
│   │           └── generation.ts        (tRPC router for generation control)
│   ├── app/
│   │   └── app/
│   │       └── projects/
│   │           └── [id]/
│   │               └── page.tsx         (project page with generate button)
│   └── components/
│       └── generation-progress.tsx      (progress indicator component)
├── tests/
│   └── server/
│       └── ai/
│           ├── schemas.test.ts          (structured output parsing tests)
│           ├── pipeline.test.ts         (pipeline orchestration tests)
│           └── llm-router.test.ts       (LLM router tests)
```

---

### Task 1: Install Vercel AI SDK + Create LLM Router Abstraction

**Files:**
- Modify: `package.json`
- Create: `src/server/ai/llm-router.ts`
- Create: `tests/server/ai/llm-router.test.ts`

- [ ] **Step 1: Install Vercel AI SDK packages**

```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic
```

- [ ] **Step 2: Write failing test for LLM Router**

Create `tests/server/ai/llm-router.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { LLMRouter, type LLMProvider } from "@/server/ai/llm-router";

describe("LLMRouter", () => {
  it("initializes with default provider", () => {
    const router = new LLMRouter({
      defaultProvider: "openai",
      providers: {
        openai: { apiKey: "test-key", model: "gpt-4o" },
      },
    });

    expect(router.getDefaultProvider()).toBe("openai");
  });

  it("returns the correct model instance for a provider", () => {
    const router = new LLMRouter({
      defaultProvider: "openai",
      providers: {
        openai: { apiKey: "test-key", model: "gpt-4o" },
        anthropic: { apiKey: "test-key-2", model: "claude-sonnet-4-20250514" },
      },
    });

    const model = router.getModel("anthropic");
    expect(model).toBeDefined();
  });

  it("throws when requesting an unconfigured provider", () => {
    const router = new LLMRouter({
      defaultProvider: "openai",
      providers: {
        openai: { apiKey: "test-key", model: "gpt-4o" },
      },
    });

    expect(() => router.getModel("anthropic")).toThrow(
      "Provider 'anthropic' is not configured"
    );
  });

  it("supports step-to-provider mapping", () => {
    const router = new LLMRouter({
      defaultProvider: "openai",
      providers: {
        openai: { apiKey: "test-key", model: "gpt-4o" },
        anthropic: { apiKey: "test-key-2", model: "claude-sonnet-4-20250514" },
      },
      stepProviderMap: {
        skeleton: "anthropic",
        nodeExpansion: "openai",
        companyDiscovery: "openai",
        deepAnalysis: "anthropic",
        profitChain: "anthropic",
      },
    });

    const model = router.getModelForStep("skeleton");
    expect(model).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- tests/server/ai/llm-router.test.ts
```

Expected: FAIL — cannot find module `@/server/ai/llm-router`

- [ ] **Step 4: Implement LLM Router**

Create `src/server/ai/llm-router.ts`:

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV1 } from "ai";

export type LLMProviderName = "openai" | "anthropic";

export type PipelineStep =
  | "skeleton"
  | "nodeExpansion"
  | "companyDiscovery"
  | "deepAnalysis"
  | "profitChain";

export interface LLMProvider {
  apiKey: string;
  model: string;
  baseURL?: string;
}

export interface LLMRouterConfig {
  defaultProvider: LLMProviderName;
  providers: Partial<Record<LLMProviderName, LLMProvider>>;
  stepProviderMap?: Partial<Record<PipelineStep, LLMProviderName>>;
}

const providerFactories: Record<
  LLMProviderName,
  (config: LLMProvider) => (modelId: string) => LanguageModelV1
> = {
  openai: (config) => {
    const provider = createOpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return (modelId: string) => provider(modelId);
  },
  anthropic: (config) => {
    const provider = createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    return (modelId: string) => provider(modelId);
  },
};

export class LLMRouter {
  private config: LLMRouterConfig;
  private modelCache: Map<string, LanguageModelV1> = new Map();

  constructor(config: LLMRouterConfig) {
    this.config = config;
  }

  getDefaultProvider(): LLMProviderName {
    return this.config.defaultProvider;
  }

  getModel(providerName?: LLMProviderName): LanguageModelV1 {
    const name = providerName ?? this.config.defaultProvider;
    const providerConfig = this.config.providers[name];

    if (!providerConfig) {
      throw new Error(`Provider '${name}' is not configured`);
    }

    const cacheKey = `${name}:${providerConfig.model}`;
    if (this.modelCache.has(cacheKey)) {
      return this.modelCache.get(cacheKey)!;
    }

    const factory = providerFactories[name];
    const model = factory(providerConfig)(providerConfig.model);
    this.modelCache.set(cacheKey, model);
    return model;
  }

  getModelForStep(step: PipelineStep): LanguageModelV1 {
    const providerName = this.config.stepProviderMap?.[step];
    return this.getModel(providerName);
  }
}

/**
 * Create an LLM Router from team API keys stored in the database.
 */
export async function createRouterFromTeamKeys(
  teamId: string,
  db: import("@prisma/client").PrismaClient
): Promise<LLMRouter> {
  const apiKeys = await db.apiKey.findMany({
    where: { teamId },
  });

  const providers: Partial<Record<LLMProviderName, LLMProvider>> = {};

  for (const key of apiKeys) {
    const providerName = key.provider as LLMProviderName;
    if (providerName === "openai" || providerName === "anthropic") {
      providers[providerName] = {
        apiKey: key.encryptedKey, // TODO: decrypt in production
        model:
          providerName === "openai" ? "gpt-4o" : "claude-sonnet-4-20250514",
      };
    }
  }

  const defaultProvider: LLMProviderName = providers.anthropic
    ? "anthropic"
    : "openai";

  if (Object.keys(providers).length === 0) {
    throw new Error("No API keys configured for this team");
  }

  return new LLMRouter({
    defaultProvider,
    providers,
    stepProviderMap: {
      skeleton: defaultProvider,
      nodeExpansion: providers.openai ? "openai" : defaultProvider,
      companyDiscovery: providers.openai ? "openai" : defaultProvider,
      deepAnalysis: defaultProvider,
      profitChain: defaultProvider,
    },
  });
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/server/ai/llm-router.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/llm-router.ts tests/server/ai/llm-router.test.ts package.json package-lock.json
git commit -m "feat: add LLM Router abstraction with Vercel AI SDK"
```

---

### Task 2: Define Zod Schemas for Structured LLM Output

**Files:**
- Create: `src/server/ai/schemas.ts`
- Create: `tests/server/ai/schemas.test.ts`

- [ ] **Step 1: Write failing tests for schema parsing**

Create `tests/server/ai/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  ChainSkeletonSchema,
  NodeExpansionSchema,
  CompanyDiscoverySchema,
  DeepAnalysisSchema,
  ProfitChainSchema,
} from "@/server/ai/schemas";

describe("AI Output Schemas", () => {
  describe("ChainSkeletonSchema (Step 1)", () => {
    it("parses a valid chain skeleton", () => {
      const data = {
        industryName: "人工智能",
        overview: "AI产业链覆盖基础设施到应用层",
        nodes: [
          {
            name: "应用层",
            description: "面向终端用户的AI应用",
            nodeType: "DOWNSTREAM",
            order: 0,
          },
          {
            name: "模型层",
            description: "大语言模型和算法研发",
            nodeType: "MIDSTREAM",
            order: 1,
          },
          {
            name: "算力层",
            description: "GPU/TPU等计算基础设施",
            nodeType: "UPSTREAM",
            order: 2,
          },
        ],
      };

      const result = ChainSkeletonSchema.parse(data);
      expect(result.nodes).toHaveLength(3);
      expect(result.nodes[0].nodeType).toBe("DOWNSTREAM");
    });

    it("rejects invalid nodeType", () => {
      const data = {
        industryName: "AI",
        overview: "test",
        nodes: [
          {
            name: "Test",
            description: "test",
            nodeType: "INVALID",
            order: 0,
          },
        ],
      };

      expect(() => ChainSkeletonSchema.parse(data)).toThrow();
    });
  });

  describe("NodeExpansionSchema (Step 2)", () => {
    it("parses node expansion with sub-nodes", () => {
      const data = {
        parentNodeName: "算力层",
        subNodes: [
          {
            name: "GPU芯片",
            description: "图形处理器，AI训练的核心硬件",
            nodeType: "UPSTREAM",
            order: 0,
            profitMargin: "60-70%",
            marketSize: "800亿美元",
            growthTrend: "年增长30%+",
            keyDrivers: ["AI训练需求爆发", "数据中心扩建"],
          },
          {
            name: "AI服务器",
            description: "搭载GPU的高性能服务器",
            nodeType: "UPSTREAM",
            order: 1,
            profitMargin: "15-25%",
            marketSize: "300亿美元",
            growthTrend: "年增长25%",
            keyDrivers: ["云计算扩展", "大模型训练"],
          },
        ],
      };

      const result = NodeExpansionSchema.parse(data);
      expect(result.subNodes).toHaveLength(2);
      expect(result.subNodes[0].keyDrivers).toHaveLength(2);
    });
  });

  describe("CompanyDiscoverySchema (Step 3)", () => {
    it("parses company list for a node", () => {
      const data = {
        nodeName: "GPU芯片",
        companies: [
          {
            name: "NVIDIA",
            ticker: "NVDA",
            exchange: "NASDAQ",
            isPublic: true,
            country: "美国",
            mainBusiness: "GPU芯片设计与AI计算平台",
            coreProducts: ["H100", "A100", "CUDA"],
            marketPosition: "LEADER",
            marketShare: "80%+",
          },
          {
            name: "AMD",
            ticker: "AMD",
            exchange: "NASDAQ",
            isPublic: true,
            country: "美国",
            mainBusiness: "CPU和GPU芯片设计",
            coreProducts: ["MI300X", "Instinct系列"],
            marketPosition: "CHALLENGER",
            marketShare: "10-15%",
          },
        ],
      };

      const result = CompanyDiscoverySchema.parse(data);
      expect(result.companies).toHaveLength(2);
      expect(result.companies[0].marketPosition).toBe("LEADER");
    });
  });

  describe("DeepAnalysisSchema (Step 4)", () => {
    it("parses deep analysis for a company", () => {
      const data = {
        companyName: "NVIDIA",
        financials: {
          marketCap: "3万亿美元",
          revenue: "609亿美元 (FY2024)",
          revenueGrowth: "126% YoY",
          grossMargin: "72.7%",
          netMargin: "55.0%",
          roe: "91%",
          financialTrend: {
            years: ["2021", "2022", "2023", "2024"],
            revenue: ["166亿", "270亿", "270亿", "609亿"],
            netIncome: ["44亿", "97亿", "43亿", "297亿"],
          },
        },
        competitive: {
          moat: "CUDA生态系统锁定+领先制程+软件栈",
          competitors: ["AMD", "Intel", "Google TPU"],
        },
        investment: {
          highlights: [
            "AI训练芯片绝对龙头，市占率80%+",
            "CUDA生态系统形成强护城河",
            "数据中心业务爆发式增长",
          ],
          risks: [
            "估值处于高位",
            "客户自研芯片趋势（Google TPU, Amazon Trainium）",
            "中国市场受出口管制限制",
          ],
          analystRating: "买入",
          customerConcentration:
            "前5大客户占比约50%（Microsoft, Meta, Amazon, Google, Tesla）",
        },
      };

      const result = DeepAnalysisSchema.parse(data);
      expect(result.investment.highlights).toHaveLength(3);
      expect(result.financials.grossMargin).toBe("72.7%");
    });
  });

  describe("ProfitChainSchema (Step 5)", () => {
    it("parses profit chain analysis", () => {
      const data = {
        summary: "AI产业链利润集中在上游芯片设计环节",
        nodeAnalyses: [
          {
            nodeName: "GPU芯片",
            profitMargin: "65%",
            valueFlow: "向下游提供算力基础设施，掌握定价权",
            profitConcentration: "HIGH",
            reason: "技术壁垒高、CUDA生态锁定、供不应求",
          },
          {
            nodeName: "AI服务器",
            profitMargin: "18%",
            valueFlow: "组装GPU等组件为可用的计算单元",
            profitConcentration: "MEDIUM",
            reason: "组装环节附加值有限但受益于整体需求增长",
          },
        ],
        profitFlowDescription:
          "利润从下游应用向上游芯片集中，芯片设计环节获取最高利润率",
      };

      const result = ProfitChainSchema.parse(data);
      expect(result.nodeAnalyses).toHaveLength(2);
      expect(result.nodeAnalyses[0].profitConcentration).toBe("HIGH");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/server/ai/schemas.test.ts
```

Expected: FAIL — cannot find module `@/server/ai/schemas`

- [ ] **Step 3: Implement schemas**

Create `src/server/ai/schemas.ts`:

```typescript
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
    .max(8)
    .describe("一级产业环节列表，3-8个"),
});

export type ChainSkeleton = z.infer<typeof ChainSkeletonSchema>;

// ─── Step 2: Node Expansion ──────────────────────

export const SubNodeSchema = z.object({
  name: z.string().describe("子环节名称"),
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
    .describe("核心驱动因素，2-4个"),
});

export const NodeExpansionSchema = z.object({
  parentNodeName: z.string().describe("父环节名称"),
  subNodes: z
    .array(SubNodeSchema)
    .min(2)
    .max(6)
    .describe("子环节列表，2-6个"),
});

export type NodeExpansion = z.infer<typeof NodeExpansionSchema>;

// ─── Step 3: Company Discovery ───────────────────

export const DiscoveredCompanySchema = z.object({
  name: z.string().describe("公司名称"),
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
    .min(2)
    .max(8)
    .describe("代表性公司列表，2-8家"),
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
    .min(2)
    .describe("各环节利润分析"),
  profitFlowDescription: z.string().describe("利润在产业链中的整体流向描述"),
});

export type ProfitChain = z.infer<typeof ProfitChainSchema>;
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/server/ai/schemas.test.ts
```

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/schemas.ts tests/server/ai/schemas.test.ts
git commit -m "feat: add Zod schemas for structured LLM output (5 pipeline steps)"
```

---

### Task 3: Create Prompt Templates

**Files:**
- Create: `src/server/ai/prompts.ts`

- [ ] **Step 1: Implement prompt templates**

Create `src/server/ai/prompts.ts`:

```typescript
import type { PipelineStep } from "./llm-router";

/**
 * System prompt shared across all pipeline steps.
 */
const SYSTEM_PROMPT = `你是一位资深产业分析师和投资研究专家。你的任务是对产业链进行深入、专业的分析。
要求：
- 分析必须基于真实的行业认知，不要编造数据
- 使用中文输出
- 保持专业、简洁、有洞察力
- 对于财务数据，标注为估算值并注明数据年份`;

/**
 * Step 1: Generate the industry chain skeleton.
 */
export function skeletonPrompt(industry: string): string {
  return `请分析"${industry}"行业的产业链结构。

要求：
1. 将产业链拆分为3-8个一级环节
2. 每个环节标注为 UPSTREAM（上游）、MIDSTREAM（中游）或 DOWNSTREAM（下游）
3. 按照从下游到上游的顺序排列（order=0 为最下游）
4. 为整个行业提供简要概述

输出格式严格按照 schema 定义。`;
}

/**
 * Step 2: Expand a node into sub-nodes.
 */
export function nodeExpansionPrompt(
  industry: string,
  nodeName: string,
  nodeDescription: string,
  depth: number
): string {
  return `在"${industry}"产业链中，"${nodeName}"环节的描述是：${nodeDescription}

请将该环节细分为2-6个子环节（当前层级深度为 ${depth}）。

对每个子环节：
1. 给出名称和详细描述
2. 标注产业链位置（UPSTREAM/MIDSTREAM/DOWNSTREAM）
3. 估算典型利润率范围
4. 估算市场规模
5. 分析增长趋势
6. 列出2-4个核心驱动因素

输出格式严格按照 schema 定义。`;
}

/**
 * Step 3: Discover companies for a chain node.
 */
export function companyDiscoveryPrompt(
  industry: string,
  nodeName: string,
  nodeDescription: string
): string {
  return `在"${industry}"产业链的"${nodeName}"环节（${nodeDescription}），请列出2-8家最具代表性的公司。

要求：
1. 优先列出行业龙头和上市公司
2. 覆盖不同市场地位（龙头/挑战者/新兴/细分）
3. 提供股票代码（如有）和交易所信息
4. 评估市场地位和预估市场份额
5. 列出核心产品/服务

输出格式严格按照 schema 定义。`;
}

/**
 * Step 4: Deep analysis for a specific company.
 */
export function deepAnalysisPrompt(
  companyName: string,
  industry: string,
  nodeName: string
): string {
  return `请对"${industry}"产业链"${nodeName}"环节中的"${companyName}"进行投研级深度分析。

要求提供：
1. 财务指标：市值、年营收、营收增速、毛利率、净利率、ROE、近3-5年趋势
2. 竞争分析：护城河/技术壁垒、主要竞争对手
3. 投资分析：3-5条投资亮点、3-5条风险提示、综合评级、客户集中度

注：财务数据如为估算请标注。

输出格式严格按照 schema 定义。`;
}

/**
 * Step 5: Profit chain analysis across the industry.
 */
export function profitChainPrompt(
  industry: string,
  nodes: Array<{ name: string; description: string; nodeType: string }>
): string {
  const nodeList = nodes
    .map((n) => `- ${n.name}（${n.nodeType}）：${n.description}`)
    .join("\n");

  return `请分析"${industry}"产业链的利润链条。

产业链环节如下：
${nodeList}

请对每个环节分析：
1. 典型利润率
2. 价值流转方式
3. 利润集中程度（HIGH/MEDIUM/LOW）
4. 利润率高低的原因

最后总结利润在产业链中的整体流向和集中趋势。

输出格式严格按照 schema 定义。`;
}

/**
 * Get the system prompt.
 */
export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/ai/prompts.ts
git commit -m "feat: add prompt templates for 5-step generation pipeline"
```

---

### Task 4: Create the 5-Step Generation Pipeline

**Files:**
- Create: `src/server/ai/pipeline.ts`
- Create: `tests/server/ai/pipeline.test.ts`

- [ ] **Step 1: Write failing tests for the pipeline**

Create `tests/server/ai/pipeline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/server/db";
import { createTestUser, createTestTeam, createTestProject } from "../helpers";

// Mock the AI SDK's generateObject
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from "ai";
import {
  runSkeletonStep,
  runNodeExpansionStep,
  runCompanyDiscoveryStep,
  type PipelineContext,
} from "@/server/ai/pipeline";
import { LLMRouter } from "@/server/ai/llm-router";

const mockRouter = new LLMRouter({
  defaultProvider: "openai",
  providers: {
    openai: { apiKey: "test-key", model: "gpt-4o" },
  },
});

describe("Generation Pipeline", () => {
  let context: PipelineContext;

  beforeEach(async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createTestProject(team.id, {
      name: "AI Research",
      industry: "AI",
    });

    // Create an IndustryChain for the project
    const chain = await db.industryChain.create({
      data: {
        projectId: project.id,
        status: "GENERATING",
        maxDepth: 3,
      },
    });

    context = {
      db,
      router: mockRouter,
      chainId: chain.id,
      industry: "AI",
      maxDepth: 3,
    };
  });

  describe("Step 1: Skeleton", () => {
    it("creates root nodes from LLM output", async () => {
      const mockGenerateObject = vi.mocked(generateObject);
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          industryName: "人工智能",
          overview: "AI产业链",
          nodes: [
            {
              name: "应用层",
              description: "AI应用",
              nodeType: "DOWNSTREAM",
              order: 0,
            },
            {
              name: "模型层",
              description: "大模型",
              nodeType: "MIDSTREAM",
              order: 1,
            },
            {
              name: "算力层",
              description: "GPU等",
              nodeType: "UPSTREAM",
              order: 2,
            },
          ],
        },
        usage: { totalTokens: 500 },
      } as any);

      const nodes = await runSkeletonStep(context);

      expect(nodes).toHaveLength(3);

      // Verify nodes are persisted in DB
      const dbNodes = await db.chainNode.findMany({
        where: { chainId: context.chainId },
        orderBy: { order: "asc" },
      });
      expect(dbNodes).toHaveLength(3);
      expect(dbNodes[0].name).toBe("应用层");
      expect(dbNodes[0].parentId).toBeNull();
    });
  });

  describe("Step 2: Node Expansion", () => {
    it("creates child nodes under a parent", async () => {
      // First, create a parent node
      const parent = await db.chainNode.create({
        data: {
          chainId: context.chainId,
          name: "算力层",
          description: "GPU等计算基础设施",
          nodeType: "UPSTREAM",
          level: 0,
          order: 0,
        },
      });

      const mockGenerateObject = vi.mocked(generateObject);
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          parentNodeName: "算力层",
          subNodes: [
            {
              name: "GPU芯片",
              description: "图形处理器",
              nodeType: "UPSTREAM",
              order: 0,
              profitMargin: "65%",
              marketSize: "800亿美元",
              growthTrend: "年增长30%",
              keyDrivers: ["AI训练需求"],
            },
            {
              name: "AI服务器",
              description: "高性能服务器",
              nodeType: "UPSTREAM",
              order: 1,
              profitMargin: "18%",
              marketSize: "300亿美元",
              growthTrend: "年增长25%",
              keyDrivers: ["云计算"],
            },
          ],
        },
        usage: { totalTokens: 400 },
      } as any);

      const children = await runNodeExpansionStep(context, parent);

      expect(children).toHaveLength(2);

      const dbChildren = await db.chainNode.findMany({
        where: { parentId: parent.id },
        orderBy: { order: "asc" },
      });
      expect(dbChildren).toHaveLength(2);
      expect(dbChildren[0].name).toBe("GPU芯片");
      expect(dbChildren[0].level).toBe(1);
      expect(dbChildren[0].profitMargin).toBe("65%");
    });
  });

  describe("Step 3: Company Discovery", () => {
    it("creates companies for a node", async () => {
      const node = await db.chainNode.create({
        data: {
          chainId: context.chainId,
          name: "GPU芯片",
          description: "图形处理器",
          nodeType: "UPSTREAM",
          level: 1,
          order: 0,
        },
      });

      const mockGenerateObject = vi.mocked(generateObject);
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          nodeName: "GPU芯片",
          companies: [
            {
              name: "NVIDIA",
              ticker: "NVDA",
              exchange: "NASDAQ",
              isPublic: true,
              country: "美国",
              mainBusiness: "GPU芯片设计",
              coreProducts: ["H100", "A100"],
              marketPosition: "LEADER",
              marketShare: "80%+",
            },
          ],
        },
        usage: { totalTokens: 300 },
      } as any);

      const companies = await runCompanyDiscoveryStep(context, node);

      expect(companies).toHaveLength(1);

      const dbCompanies = await db.company.findMany({
        where: { chainNodeId: node.id },
      });
      expect(dbCompanies).toHaveLength(1);
      expect(dbCompanies[0].name).toBe("NVIDIA");
      expect(dbCompanies[0].ticker).toBe("NVDA");
      expect(dbCompanies[0].marketPosition).toBe("LEADER");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/server/ai/pipeline.test.ts
```

Expected: FAIL — cannot find module `@/server/ai/pipeline`

- [ ] **Step 3: Implement the pipeline**

Create `src/server/ai/pipeline.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/server/ai/pipeline.test.ts
```

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/pipeline.ts tests/server/ai/pipeline.test.ts
git commit -m "feat: implement 5-step AI generation pipeline with parallel execution"
```

---

### Task 5: Create tRPC Router for Generation

**Files:**
- Create: `src/server/trpc/routers/generation.ts`
- Modify: `src/server/trpc/router.ts`

- [ ] **Step 1: Implement the generation router**

Create `src/server/trpc/routers/generation.ts`:

```typescript
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, teamProcedure } from "../init";
import { runFullPipeline, type PipelineContext } from "../../ai/pipeline";
import { createRouterFromTeamKeys } from "../../ai/llm-router";

export const generationRouter = createRouter({
  /**
   * Start generating an industry chain for a project.
   * Creates the IndustryChain record and kicks off the pipeline
   * as a background task (fire-and-forget from the API perspective).
   */
  start: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        projectId: z.string(),
        maxDepth: z.number().min(2).max(5).default(3),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole === "VIEWER") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Verify project belongs to team
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, teamId: input.teamId },
        include: { chain: true },
      });

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      // Prevent re-generation if already generating
      if (project.chain?.status === "GENERATING") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Generation is already in progress",
        });
      }

      // Delete existing chain if regenerating
      if (project.chain) {
        await ctx.db.industryChain.delete({
          where: { id: project.chain.id },
        });
      }

      // Create new chain
      const chain = await ctx.db.industryChain.create({
        data: {
          projectId: input.projectId,
          status: "GENERATING",
          maxDepth: input.maxDepth,
        },
      });

      // Create LLM router from team API keys
      let router;
      try {
        router = await createRouterFromTeamKeys(input.teamId, ctx.db);
      } catch {
        await ctx.db.industryChain.update({
          where: { id: chain.id },
          data: { status: "FAILED" },
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No LLM API keys configured. Go to Settings to add your API keys.",
        });
      }

      // Fire-and-forget: run pipeline in background
      const pipelineCtx: PipelineContext = {
        db: ctx.db,
        router,
        chainId: chain.id,
        industry: project.industry,
        maxDepth: input.maxDepth,
      };

      // Don't await — let it run in the background
      runFullPipeline(pipelineCtx).catch((err) => {
        console.error("Pipeline failed:", err);
      });

      return { chainId: chain.id, status: "GENERATING" };
    }),

  /**
   * Get the current generation status and progress.
   */
  status: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        projectId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, teamId: input.teamId },
        include: {
          chain: {
            select: {
              id: true,
              status: true,
              maxDepth: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (!project.chain) {
        return { status: "PENDING" as const, nodeCount: 0, companyCount: 0 };
      }

      const [nodeCount, companyCount] = await Promise.all([
        ctx.db.chainNode.count({ where: { chainId: project.chain.id } }),
        ctx.db.company.count({
          where: { chainNode: { chainId: project.chain.id } },
        }),
      ]);

      return {
        chainId: project.chain.id,
        status: project.chain.status,
        maxDepth: project.chain.maxDepth,
        nodeCount,
        companyCount,
        updatedAt: project.chain.updatedAt,
      };
    }),

  /**
   * Get the full generated chain data (nodes + companies).
   */
  results: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        projectId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, teamId: input.teamId },
        include: {
          chain: {
            include: {
              nodes: {
                include: {
                  companies: true,
                },
                orderBy: [{ level: "asc" }, { order: "asc" }],
              },
            },
          },
        },
      });

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return {
        chain: project.chain,
        project: {
          id: project.id,
          name: project.name,
          industry: project.industry,
        },
      };
    }),
});
```

- [ ] **Step 2: Register generation router**

Update `src/server/trpc/router.ts`:

```typescript
import { createRouter } from "./init";
import { authRouter } from "./routers/auth";
import { teamRouter } from "./routers/team";
import { projectRouter } from "./routers/project";
import { generationRouter } from "./routers/generation";

export const appRouter = createRouter({
  auth: authRouter,
  team: teamRouter,
  project: projectRouter,
  generation: generationRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/generation.ts src/server/trpc/router.ts
git commit -m "feat: add tRPC generation router (start, poll status, get results)"
```

---

### Task 6: Wire Generation to Project Page UI

**Files:**
- Create: `src/app/app/projects/[id]/page.tsx`
- Create: `src/components/generation-progress.tsx`

- [ ] **Step 1: Create the generation progress component**

Create `src/components/generation-progress.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface GenerationProgressProps {
  teamId: string;
  projectId: string;
}

const statusLabels: Record<string, string> = {
  PENDING: "等待生成",
  GENERATING: "正在生成...",
  COMPLETED: "生成完成",
  FAILED: "生成失败",
};

export function GenerationProgress({
  teamId,
  projectId,
}: GenerationProgressProps) {
  const { data, refetch } = trpc.generation.status.useQuery(
    { teamId, projectId },
    { refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "GENERATING" ? 2000 : false;
      },
    }
  );

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">生成状态</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {data.status === "GENERATING" && (
              <div className="h-3 w-3 animate-pulse rounded-full bg-yellow-400" />
            )}
            {data.status === "COMPLETED" && (
              <div className="h-3 w-3 rounded-full bg-green-500" />
            )}
            {data.status === "FAILED" && (
              <div className="h-3 w-3 rounded-full bg-red-500" />
            )}
            {data.status === "PENDING" && (
              <div className="h-3 w-3 rounded-full bg-gray-300" />
            )}
            <span className="text-sm">{statusLabels[data.status] ?? data.status}</span>
          </div>
          {(data.status === "GENERATING" || data.status === "COMPLETED") && (
            <div className="text-xs text-gray-500">
              环节: {data.nodeCount} 个 | 公司: {data.companyCount} 家
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create the project detail page**

Create `src/app/app/projects/[id]/page.tsx`:

```tsx
"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerationProgress } from "@/components/generation-progress";

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  // TODO: get teamId from team context/session — hardcoded placeholder
  const teamId = ""; // Will be wired when team context is available
  const [generating, setGenerating] = useState(false);

  const startGeneration = trpc.generation.start.useMutation({
    onSuccess: () => {
      setGenerating(false);
    },
    onError: (err) => {
      setGenerating(false);
      alert(err.message);
    },
  });

  const handleGenerate = () => {
    if (!teamId) {
      alert("请先选择团队");
      return;
    }
    setGenerating(true);
    startGeneration.mutate({
      teamId,
      projectId,
      maxDepth: 3,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">项目详情</h1>
        <Button onClick={handleGenerate} disabled={generating || !teamId}>
          {generating ? "正在启动..." : "生成产业链"}
        </Button>
      </div>

      {teamId && (
        <GenerationProgress teamId={teamId} projectId={projectId} />
      )}

      {/* Tree visualization will go here in Phase 3 */}
      <Card>
        <CardHeader>
          <CardTitle>产业链可视化</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-96 items-center justify-center rounded-lg border border-dashed border-gray-300">
            <p className="text-gray-400">
              树状图可视化将在 Phase 3 中实现
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/app/projects/[id]/page.tsx src/components/generation-progress.tsx
git commit -m "feat: add project page with generation button and progress indicator"
```

---

### Task 7: End-to-End Pipeline Tests with Mocked LLM

**Files:**
- Modify: `tests/server/ai/pipeline.test.ts` (extend with full pipeline test)

- [ ] **Step 1: Add full pipeline integration test**

Append to `tests/server/ai/pipeline.test.ts`:

```typescript
describe("Full Pipeline (integration)", () => {
  it("runs all 5 steps and updates chain status to COMPLETED", async () => {
    const mockGenerateObject = vi.mocked(generateObject);

    // Step 1: Skeleton
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        industryName: "AI",
        overview: "AI产业链",
        nodes: [
          { name: "应用层", description: "AI应用", nodeType: "DOWNSTREAM", order: 0 },
          { name: "算力层", description: "GPU等", nodeType: "UPSTREAM", order: 1 },
        ],
      },
      usage: { totalTokens: 500 },
    } as any);

    // Step 2: Node expansion for "应用层"
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        parentNodeName: "应用层",
        subNodes: [
          {
            name: "企业AI",
            description: "B端AI应用",
            nodeType: "DOWNSTREAM",
            order: 0,
            keyDrivers: ["效率提升"],
          },
        ],
      },
      usage: { totalTokens: 300 },
    } as any);

    // Step 2: Node expansion for "算力层"
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        parentNodeName: "算力层",
        subNodes: [
          {
            name: "GPU",
            description: "图形处理器",
            nodeType: "UPSTREAM",
            order: 0,
            keyDrivers: ["AI训练"],
          },
        ],
      },
      usage: { totalTokens: 300 },
    } as any);

    // Step 3: Company discovery for "企业AI"
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        nodeName: "企业AI",
        companies: [
          {
            name: "Salesforce",
            isPublic: true,
            mainBusiness: "CRM+AI",
            coreProducts: ["Einstein"],
            marketPosition: "LEADER",
          },
        ],
      },
      usage: { totalTokens: 200 },
    } as any);

    // Step 3: Company discovery for "GPU"
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        nodeName: "GPU",
        companies: [
          {
            name: "NVIDIA",
            ticker: "NVDA",
            isPublic: true,
            mainBusiness: "GPU",
            coreProducts: ["H100"],
            marketPosition: "LEADER",
          },
        ],
      },
      usage: { totalTokens: 200 },
    } as any);

    // Step 4: Deep analysis for Salesforce (LEADER)
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        companyName: "Salesforce",
        financials: { revenue: "300亿美元" },
        competitive: { moat: "CRM生态", competitors: ["Microsoft"] },
        investment: {
          highlights: ["AI整合领先"],
          risks: ["竞争激烈"],
          analystRating: "持有",
        },
      },
      usage: { totalTokens: 400 },
    } as any);

    // Step 4: Deep analysis for NVIDIA (LEADER)
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        companyName: "NVIDIA",
        financials: { revenue: "609亿美元" },
        competitive: { moat: "CUDA生态", competitors: ["AMD"] },
        investment: {
          highlights: ["AI龙头"],
          risks: ["估值高"],
          analystRating: "买入",
        },
      },
      usage: { totalTokens: 400 },
    } as any);

    // Step 5: Profit chain
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        summary: "利润集中在上游芯片",
        nodeAnalyses: [
          {
            nodeName: "GPU",
            profitMargin: "65%",
            valueFlow: "提供算力",
            profitConcentration: "HIGH",
            reason: "技术壁垒高",
          },
          {
            nodeName: "企业AI",
            profitMargin: "20%",
            valueFlow: "交付应用价值",
            profitConcentration: "MEDIUM",
            reason: "竞争激烈",
          },
        ],
        profitFlowDescription: "利润向上游集中",
      },
      usage: { totalTokens: 300 },
    } as any);

    // Run full pipeline
    const { runFullPipeline } = await import("@/server/ai/pipeline");
    await runFullPipeline(context);

    // Verify chain status
    const chain = await db.industryChain.findUnique({
      where: { id: context.chainId },
    });
    expect(chain!.status).toBe("COMPLETED");

    // Verify nodes created
    const nodes = await db.chainNode.findMany({
      where: { chainId: context.chainId },
    });
    expect(nodes.length).toBeGreaterThanOrEqual(4); // 2 root + 2 children

    // Verify companies created
    const companies = await db.company.findMany({
      where: { chainNode: { chainId: context.chainId } },
    });
    expect(companies.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run all pipeline tests**

```bash
npm test -- tests/server/ai/pipeline.test.ts
```

Expected: All tests PASS (3 step tests + 1 integration test)

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: All tests pass (17 existing + ~10 new = 27+ tests)

- [ ] **Step 4: Commit**

```bash
git add tests/server/ai/pipeline.test.ts
git commit -m "test: add full pipeline integration test with mocked LLM responses"
```

---

## Phase 2 Complete

After completing all 7 tasks, you have:

- Vercel AI SDK installed with LLM Router abstraction (multi-provider support)
- 5 Zod schemas for structured LLM output (skeleton, node expansion, company discovery, deep analysis, profit chain)
- Full 5-step generation pipeline with parallel execution and concurrency control
- Prompt templates optimized for each pipeline step
- tRPC router for generation control (start, poll status, get results)
- Project page with generate button and live progress indicator
- Comprehensive test suite with mocked LLM responses (~10 new tests)

**Next:** Phase 3 (D3.js Tree Visualization) will render the generated data as an interactive tree.
