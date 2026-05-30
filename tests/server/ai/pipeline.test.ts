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
  runFullPipeline,
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
    vi.clearAllMocks();
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

      // Run full pipeline with maxDepth=2 so expansion stops after one level
      await runFullPipeline({ ...context, maxDepth: 2 });

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
