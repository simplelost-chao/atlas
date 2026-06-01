import { describe, it, expect } from "vitest";
import {
  chainNodesToHierarchy,
  type TreeNode,
  flattenTree,
  findNodeById,
} from "@/lib/tree-utils";
import type { ChainNode, Company } from "@prisma/client";

// Helper to create mock ChainNode data
function mockNode(
  overrides: Partial<ChainNode> & { id: string; name: string; companies?: Company[] }
): ChainNode & { companies: Company[] } {
  return {
    id: overrides.id,
    chainId: "chain-1",
    parentId: overrides.parentId ?? null,
    name: overrides.name,
    description: overrides.description ?? "",
    nodeType: overrides.nodeType ?? "MIDSTREAM",
    level: overrides.level ?? 0,
    order: overrides.order ?? 0,
    profitMargin: overrides.profitMargin ?? null,
    marketSize: overrides.marketSize ?? null,
    growthTrend: overrides.growthTrend ?? null,
    keyDrivers: overrides.keyDrivers ?? [],
    valueFlow: overrides.valueFlow ?? null,
    aliases: overrides.aliases ?? [],
    normKey: overrides.normKey ?? "",
    syncStatus: overrides.syncStatus ?? "CONFIRMED",
    syncSource: overrides.syncSource ?? "ATLAS_PIPELINE",
    evidenceGrade: overrides.evidenceGrade ?? null,
    bottleneckLayer: overrides.bottleneckLayer ?? null,
    themeIds: overrides.themeIds ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
    companies: (overrides as any).companies ?? [],
  };
}

describe("tree-utils", () => {
  describe("chainNodesToHierarchy", () => {
    it("transforms flat ChainNode array into D3 hierarchy", () => {
      const nodes = [
        mockNode({ id: "root", name: "AI产业链", level: 0 }),
        mockNode({
          id: "app",
          name: "应用层",
          parentId: "root",
          level: 1,
          nodeType: "DOWNSTREAM",
        }),
        mockNode({
          id: "infra",
          name: "算力层",
          parentId: "root",
          level: 1,
          nodeType: "UPSTREAM",
        }),
        mockNode({
          id: "gpu",
          name: "GPU",
          parentId: "infra",
          level: 2,
          nodeType: "UPSTREAM",
        }),
      ];

      const tree = chainNodesToHierarchy(nodes, "AI");

      expect(tree.name).toBe("AI");
      expect(tree.children).toHaveLength(1); // root node
      expect(tree.children![0].name).toBe("AI产业链");
      expect(tree.children![0].children).toHaveLength(2); // app + infra
    });

    it("handles nodes with no parent as roots under the industry node", () => {
      const nodes = [
        mockNode({
          id: "up",
          name: "上游",
          nodeType: "UPSTREAM",
          level: 0,
        }),
        mockNode({
          id: "down",
          name: "下游",
          nodeType: "DOWNSTREAM",
          level: 0,
        }),
      ];

      const tree = chainNodesToHierarchy(nodes, "半导体");
      expect(tree.name).toBe("半导体");
      expect(tree.children).toHaveLength(2);
    });

    it("attaches companies to leaf nodes", () => {
      const nodes = [
        mockNode({
          id: "gpu",
          name: "GPU",
          level: 0,
          companies: [
            {
              id: "nvda",
              name: "NVIDIA",
              chainNodeId: "gpu",
              ticker: "NVDA",
              marketPosition: "LEADER",
              isPublic: true,
            },
          ] as any,
        }),
      ];

      const tree = chainNodesToHierarchy(nodes, "AI");
      expect(tree.children![0].data.companies).toHaveLength(1);
      expect(tree.children![0].data.companies![0].name).toBe("NVIDIA");
    });

    it("sorts children by order", () => {
      const nodes = [
        mockNode({ id: "b", name: "B", level: 0, order: 1 }),
        mockNode({ id: "a", name: "A", level: 0, order: 0 }),
        mockNode({ id: "c", name: "C", level: 0, order: 2 }),
      ];

      const tree = chainNodesToHierarchy(nodes, "Test");
      const names = tree.children!.map((c) => c.name);
      expect(names).toEqual(["A", "B", "C"]);
    });
  });

  describe("flattenTree", () => {
    it("returns all nodes in a flat array", () => {
      const nodes = [
        mockNode({ id: "root", name: "Root", level: 0 }),
        mockNode({ id: "child", name: "Child", parentId: "root", level: 1 }),
      ];

      const tree = chainNodesToHierarchy(nodes, "Test");
      const flat = flattenTree(tree);
      expect(flat.length).toBeGreaterThanOrEqual(3); // industry root + root + child
    });
  });

  describe("findNodeById", () => {
    it("finds a node by its id in the tree", () => {
      const nodes = [
        mockNode({ id: "root", name: "Root", level: 0 }),
        mockNode({ id: "child", name: "Child", parentId: "root", level: 1 }),
      ];

      const tree = chainNodesToHierarchy(nodes, "Test");
      const found = findNodeById(tree, "child");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Child");
    });

    it("returns null for non-existent id", () => {
      const tree = chainNodesToHierarchy([], "Test");
      expect(findNodeById(tree, "nope")).toBeNull();
    });
  });
});
