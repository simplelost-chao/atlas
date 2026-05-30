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
