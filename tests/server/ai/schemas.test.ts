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
