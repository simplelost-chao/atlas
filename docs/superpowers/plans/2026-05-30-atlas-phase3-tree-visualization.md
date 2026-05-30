# Atlas Phase 3: D3.js Tree Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive, zoomable D3.js tree visualization that renders the generated industry chain data. Users can expand/collapse nodes, click to view company details in a side panel, and search/filter across the tree.

**Architecture:** React wraps D3 — React manages state and renders the SVG container, D3 handles layout computation (`d3.tree()`), link paths, and transitions. Data flows from Prisma (via tRPC) through a transformation layer into D3's hierarchy format. The tree renders horizontally (root on left, leaves on right).

**Tech Stack:** D3.js v7, React 19, tRPC v11, Prisma v7, Tailwind CSS v4, Next.js 16

---

## File Structure

```
atlas/
├── src/
│   ├── lib/
│   │   └── tree-utils.ts                (ChainNode[] → D3 hierarchy transformation)
│   ├── components/
│   │   ├── tree/
│   │   │   ├── industry-tree.tsx         (main tree component — React + D3)
│   │   │   ├── tree-node.tsx             (individual node rendering)
│   │   │   ├── tree-link.tsx             (link/edge rendering)
│   │   │   ├── tree-controls.tsx         (zoom controls, reset, fit-to-screen)
│   │   │   └── tree-minimap.tsx          (optional: overview minimap)
│   │   ├── company-panel.tsx             (side panel for company details)
│   │   ├── search-bar.tsx                (search + filter bar)
│   │   └── node-context-menu.tsx         (right-click context menu)
│   ├── app/
│   │   └── app/
│   │       └── projects/
│   │           └── [id]/
│   │               ├── page.tsx          (modify: wire tree view)
│   │               └── company/
│   │                   └── [cid]/
│   │                       └── page.tsx  (company detail page)
│   └── hooks/
│       ├── use-tree-zoom.ts              (zoom/pan hook)
│       └── use-tree-search.ts            (search/filter hook)
├── tests/
│   └── server/
│       └── tree-utils.test.ts            (data transformation tests)
```

---

### Task 1: Install D3.js and Create Tree Data Transformation

**Files:**
- Modify: `package.json`
- Create: `src/lib/tree-utils.ts`
- Create: `tests/server/tree-utils.test.ts`

- [ ] **Step 1: Install D3.js**

```bash
npm install d3
npm install --save-dev @types/d3
```

- [ ] **Step 2: Write failing tests for data transformation**

Create `tests/server/tree-utils.test.ts`:

```typescript
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
  overrides: Partial<ChainNode> & { id: string; name: string }
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
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- tests/server/tree-utils.test.ts
```

Expected: FAIL — cannot find module `@/lib/tree-utils`

- [ ] **Step 4: Implement tree data transformation**

Create `src/lib/tree-utils.ts`:

```typescript
import type { ChainNode, Company } from "@prisma/client";

export interface TreeNodeData {
  id: string;
  nodeType: string;
  level: number;
  description: string;
  profitMargin: string | null;
  marketSize: string | null;
  growthTrend: string | null;
  keyDrivers: string[];
  valueFlow: string | null;
  companies?: Company[];
  isIndustryRoot?: boolean;
}

export interface TreeNode {
  name: string;
  data: TreeNodeData;
  children?: TreeNode[];
  _collapsed?: boolean;
}

type ChainNodeWithCompanies = ChainNode & { companies: Company[] };

/**
 * Transform a flat array of ChainNodes (with companies) into a D3-compatible
 * hierarchical tree structure.
 *
 * Creates a virtual root node named after the industry keyword,
 * with all parentId=null nodes as its children.
 */
export function chainNodesToHierarchy(
  nodes: ChainNodeWithCompanies[],
  industryName: string
): TreeNode {
  // Build a map of id → TreeNode
  const nodeMap = new Map<string, TreeNode>();

  for (const node of nodes) {
    nodeMap.set(node.id, {
      name: node.name,
      data: {
        id: node.id,
        nodeType: node.nodeType,
        level: node.level,
        description: node.description,
        profitMargin: node.profitMargin,
        marketSize: node.marketSize,
        growthTrend: node.growthTrend,
        keyDrivers: node.keyDrivers,
        valueFlow: node.valueFlow,
        companies: node.companies ?? [],
      },
      children: [],
    });
  }

  // Build tree structure
  const roots: TreeNode[] = [];

  for (const node of nodes) {
    const treeNode = nodeMap.get(node.id)!;

    if (node.parentId && nodeMap.has(node.parentId)) {
      const parent = nodeMap.get(node.parentId)!;
      parent.children!.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }

  // Sort children by order at each level
  function sortChildren(node: TreeNode): void {
    if (node.children && node.children.length > 0) {
      node.children.sort((a, b) => {
        const orderA = nodes.find((n) => n.id === a.data.id)?.order ?? 0;
        const orderB = nodes.find((n) => n.id === b.data.id)?.order ?? 0;
        return orderA - orderB;
      });
      node.children.forEach(sortChildren);
    }
  }

  roots.sort((a, b) => {
    const orderA = nodes.find((n) => n.id === a.data.id)?.order ?? 0;
    const orderB = nodes.find((n) => n.id === b.data.id)?.order ?? 0;
    return orderA - orderB;
  });

  // Create the virtual industry root
  const root: TreeNode = {
    name: industryName,
    data: {
      id: "industry-root",
      nodeType: "ROOT",
      level: -1,
      description: `${industryName}产业链`,
      profitMargin: null,
      marketSize: null,
      growthTrend: null,
      keyDrivers: [],
      valueFlow: null,
      isIndustryRoot: true,
    },
    children: roots,
  };

  sortChildren(root);
  return root;
}

/**
 * Flatten a tree into an array of all nodes (DFS traversal).
 */
export function flattenTree(node: TreeNode): TreeNode[] {
  const result: TreeNode[] = [node];
  if (node.children) {
    for (const child of node.children) {
      result.push(...flattenTree(child));
    }
  }
  return result;
}

/**
 * Find a node by its data.id in the tree.
 */
export function findNodeById(root: TreeNode, id: string): TreeNode | null {
  if (root.data.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Filter tree nodes by a predicate, preserving the tree structure
 * (keeps ancestors of matching nodes).
 */
export function filterTree(
  node: TreeNode,
  predicate: (node: TreeNode) => boolean
): TreeNode | null {
  if (predicate(node)) {
    return {
      ...node,
      children: node.children
        ?.map((child) => filterTree(child, predicate))
        .filter(Boolean) as TreeNode[],
    };
  }

  if (node.children) {
    const filteredChildren = node.children
      .map((child) => filterTree(child, predicate))
      .filter(Boolean) as TreeNode[];

    if (filteredChildren.length > 0) {
      return { ...node, children: filteredChildren };
    }
  }

  return null;
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/server/tree-utils.test.ts
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/tree-utils.ts tests/server/tree-utils.test.ts package.json package-lock.json
git commit -m "feat: add D3.js and tree data transformation utilities"
```

---

### Task 2: Create the Tree Layout Component (React + D3)

**Files:**
- Create: `src/hooks/use-tree-zoom.ts`
- Create: `src/components/tree/industry-tree.tsx`
- Create: `src/components/tree/tree-node.tsx`
- Create: `src/components/tree/tree-link.tsx`
- Create: `src/components/tree/tree-controls.tsx`

- [ ] **Step 1: Create zoom/pan hook**

Create `src/hooks/use-tree-zoom.ts`:

```typescript
"use client";

import { useRef, useEffect, useCallback } from "react";
import * as d3 from "d3";

interface UseTreeZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  initialTransform?: d3.ZoomTransform;
}

export function useTreeZoom(options: UseTreeZoomOptions = {}) {
  const { minZoom = 0.1, maxZoom = 3 } = options;

  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>();
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([minZoom, maxZoom])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr("transform", event.transform.toString());
        transformRef.current = event.transform;
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    return () => {
      svg.on(".zoom", null);
    };
  }, [minZoom, maxZoom]);

  const zoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(300).call(zoomRef.current.scaleBy, 1.3);
  }, []);

  const zoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(300).call(zoomRef.current.scaleBy, 0.7);
  }, []);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    svg
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  const fitToScreen = useCallback(() => {
    if (!svgRef.current || !gRef.current || !zoomRef.current) return;
    const svg = d3.select(svgRef.current);
    const bounds = gRef.current.getBBox();
    const svgRect = svgRef.current.getBoundingClientRect();

    const fullWidth = svgRect.width;
    const fullHeight = svgRect.height;

    const scale =
      0.9 *
      Math.min(
        fullWidth / (bounds.width || 1),
        fullHeight / (bounds.height || 1)
      );

    const tx = fullWidth / 2 - scale * (bounds.x + bounds.width / 2);
    const ty = fullHeight / 2 - scale * (bounds.y + bounds.height / 2);

    svg
      .transition()
      .duration(500)
      .call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
  }, []);

  return {
    svgRef,
    gRef,
    zoomIn,
    zoomOut,
    resetZoom,
    fitToScreen,
    transformRef,
  };
}
```

- [ ] **Step 2: Create tree node component**

Create `src/components/tree/tree-node.tsx`:

```tsx
"use client";

import type { HierarchyPointNode } from "d3";
import type { TreeNode, TreeNodeData } from "@/lib/tree-utils";

interface TreeNodeComponentProps {
  node: HierarchyPointNode<TreeNode>;
  isSelected: boolean;
  isHighlighted: boolean;
  onNodeClick: (node: HierarchyPointNode<TreeNode>) => void;
  onNodeToggle: (node: HierarchyPointNode<TreeNode>) => void;
}

const NODE_TYPE_COLORS: Record<string, string> = {
  ROOT: "#6366f1",
  UPSTREAM: "#ef4444",
  MIDSTREAM: "#f59e0b",
  DOWNSTREAM: "#22c55e",
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 70;

export function TreeNodeComponent({
  node,
  isSelected,
  isHighlighted,
  onNodeClick,
  onNodeToggle,
}: TreeNodeComponentProps) {
  const { data } = node;
  const color = NODE_TYPE_COLORS[data.data.nodeType] ?? "#6b7280";
  const hasChildren =
    (node.data.children && node.data.children.length > 0) ||
    (node.data as any)._children?.length > 0;
  const companyCount = data.data.companies?.length ?? 0;

  return (
    <g
      transform={`translate(${node.y},${node.x})`}
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onNodeClick(node);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onNodeToggle(node);
      }}
    >
      {/* Node background */}
      <rect
        x={-NODE_WIDTH / 2}
        y={-NODE_HEIGHT / 2}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={8}
        ry={8}
        fill="white"
        stroke={isSelected ? "#3b82f6" : isHighlighted ? "#fbbf24" : color}
        strokeWidth={isSelected ? 2.5 : 1.5}
        className="transition-all duration-200"
        filter={isSelected ? "url(#shadow)" : undefined}
      />

      {/* Node type color bar */}
      <rect
        x={-NODE_WIDTH / 2}
        y={-NODE_HEIGHT / 2}
        width={5}
        height={NODE_HEIGHT}
        rx={8}
        fill={color}
      />

      {/* Node name */}
      <text
        dy="-0.3em"
        x={-NODE_WIDTH / 2 + 14}
        fontSize="13"
        fontWeight="600"
        fill="#1f2937"
        textAnchor="start"
      >
        {data.name.length > 12 ? data.name.slice(0, 12) + "..." : data.name}
      </text>

      {/* Metrics row */}
      <text
        dy="1.2em"
        x={-NODE_WIDTH / 2 + 14}
        fontSize="10"
        fill="#6b7280"
        textAnchor="start"
      >
        {data.data.profitMargin && `利润率: ${data.data.profitMargin}`}
        {!data.data.profitMargin &&
          data.data.marketSize &&
          `规模: ${data.data.marketSize}`}
      </text>

      {/* Company count badge */}
      {companyCount > 0 && (
        <g transform={`translate(${NODE_WIDTH / 2 - 20}, ${-NODE_HEIGHT / 2 + 8})`}>
          <circle r={10} fill={color} opacity={0.9} />
          <text
            fontSize="9"
            fill="white"
            textAnchor="middle"
            dy="0.35em"
            fontWeight="bold"
          >
            {companyCount}
          </text>
        </g>
      )}

      {/* Expand/collapse indicator */}
      {hasChildren && (
        <g transform={`translate(${NODE_WIDTH / 2 + 12}, 0)`}>
          <circle
            r={9}
            fill="white"
            stroke={color}
            strokeWidth={1.5}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onNodeToggle(node);
            }}
          />
          <text
            fontSize="14"
            fill={color}
            textAnchor="middle"
            dy="0.35em"
            fontWeight="bold"
          >
            {node.data._collapsed ? "+" : "-"}
          </text>
        </g>
      )}
    </g>
  );
}

export { NODE_WIDTH, NODE_HEIGHT };
```

- [ ] **Step 3: Create tree link component**

Create `src/components/tree/tree-link.tsx`:

```tsx
"use client";

import { linkHorizontal, type HierarchyPointLink } from "d3";
import type { TreeNode } from "@/lib/tree-utils";

interface TreeLinkComponentProps {
  link: HierarchyPointLink<TreeNode>;
}

export function TreeLinkComponent({ link }: TreeLinkComponentProps) {
  const pathGenerator = linkHorizontal<
    HierarchyPointLink<TreeNode>,
    HierarchyPointLink<TreeNode>["source"]
  >()
    .x((d) => d.y)
    .y((d) => d.x);

  const path = pathGenerator(link);

  return (
    <path
      d={path ?? ""}
      fill="none"
      stroke="#d1d5db"
      strokeWidth={1.5}
      strokeOpacity={0.6}
      className="transition-all duration-300"
    />
  );
}
```

- [ ] **Step 4: Create tree controls component**

Create `src/components/tree/tree-controls.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";

interface TreeControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToScreen: () => void;
}

export function TreeControls({
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToScreen,
}: TreeControlsProps) {
  return (
    <div className="absolute bottom-4 right-4 flex flex-col gap-1">
      <Button variant="outline" size="icon" onClick={onZoomIn} title="放大">
        <span className="text-lg">+</span>
      </Button>
      <Button variant="outline" size="icon" onClick={onZoomOut} title="缩小">
        <span className="text-lg">-</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onFitToScreen}
        title="适应屏幕"
      >
        <span className="text-xs">FIT</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onResetZoom}
        title="重置缩放"
      >
        <span className="text-xs">1:1</span>
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Create the main IndustryTree component**

Create `src/components/tree/industry-tree.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import * as d3 from "d3";
import type { HierarchyPointNode } from "d3";
import {
  chainNodesToHierarchy,
  type TreeNode,
  flattenTree,
} from "@/lib/tree-utils";
import { TreeNodeComponent, NODE_HEIGHT } from "./tree-node";
import { TreeLinkComponent } from "./tree-link";
import { TreeControls } from "./tree-controls";
import { useTreeZoom } from "@/hooks/use-tree-zoom";
import type { ChainNode, Company } from "@prisma/client";

type ChainNodeWithCompanies = ChainNode & { companies: Company[] };

interface IndustryTreeProps {
  nodes: ChainNodeWithCompanies[];
  industryName: string;
  selectedNodeId?: string | null;
  highlightedNodeIds?: Set<string>;
  onNodeSelect?: (nodeId: string, companies: Company[]) => void;
}

const NODE_SPACING_X = 250; // horizontal spacing between levels
const NODE_SPACING_Y = 90; // vertical spacing between siblings

export function IndustryTree({
  nodes,
  industryName,
  selectedNodeId,
  highlightedNodeIds = new Set(),
  onNodeSelect,
}: IndustryTreeProps) {
  const { svgRef, gRef, zoomIn, zoomOut, resetZoom, fitToScreen } =
    useTreeZoom();

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Build the tree hierarchy
  const rootData = useMemo(
    () => chainNodesToHierarchy(nodes, industryName),
    [nodes, industryName]
  );

  // Apply collapse state
  const visibleRoot = useMemo(() => {
    function applyCollapse(node: TreeNode): TreeNode {
      const collapsed = collapsedIds.has(node.data.id);
      return {
        ...node,
        _collapsed: collapsed,
        children: collapsed
          ? undefined
          : node.children?.map(applyCollapse),
      };
    }
    return applyCollapse(rootData);
  }, [rootData, collapsedIds]);

  // Compute D3 tree layout
  const { layoutNodes, layoutLinks } = useMemo(() => {
    const hierarchy = d3.hierarchy(visibleRoot);
    const treeLayout = d3
      .tree<TreeNode>()
      .nodeSize([NODE_SPACING_Y, NODE_SPACING_X])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.2));

    const root = treeLayout(hierarchy);
    return {
      layoutNodes: root.descendants(),
      layoutLinks: root.links(),
    };
  }, [visibleRoot]);

  // Auto-fit on initial render
  useEffect(() => {
    const timer = setTimeout(fitToScreen, 100);
    return () => clearTimeout(timer);
  }, [fitToScreen]);

  const handleNodeClick = useCallback(
    (node: HierarchyPointNode<TreeNode>) => {
      const nodeData = node.data;
      onNodeSelect?.(nodeData.data.id, nodeData.data.companies ?? []);
    },
    [onNodeSelect]
  );

  const handleNodeToggle = useCallback(
    (node: HierarchyPointNode<TreeNode>) => {
      const nodeId = node.data.data.id;
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    []
  );

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <svg ref={svgRef} className="h-full w-full">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow
              dx="0"
              dy="2"
              stdDeviation="3"
              floodOpacity="0.15"
            />
          </filter>
        </defs>
        <g ref={gRef}>
          {/* Links */}
          {layoutLinks.map((link, i) => (
            <TreeLinkComponent key={`link-${i}`} link={link} />
          ))}

          {/* Nodes */}
          {layoutNodes.map((node) => (
            <TreeNodeComponent
              key={node.data.data.id}
              node={node}
              isSelected={selectedNodeId === node.data.data.id}
              isHighlighted={highlightedNodeIds.has(node.data.data.id)}
              onNodeClick={handleNodeClick}
              onNodeToggle={handleNodeToggle}
            />
          ))}
        </g>
      </svg>

      <TreeControls
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
        onFitToScreen={fitToScreen}
      />
    </div>
  );
}
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-tree-zoom.ts src/components/tree/
git commit -m "feat: add D3.js tree layout component with zoom/pan and expand/collapse"
```

---

### Task 3: Company Detail Side Panel

**Files:**
- Create: `src/components/company-panel.tsx`

- [ ] **Step 1: Create the company panel component**

Create `src/components/company-panel.tsx`:

```tsx
"use client";

import type { Company } from "@prisma/client";
import { Button } from "@/components/ui/button";

interface CompanyPanelProps {
  company: Company | null;
  onClose: () => void;
}

const POSITION_LABELS: Record<string, string> = {
  LEADER: "行业龙头",
  CHALLENGER: "挑战者",
  EMERGING: "新兴力量",
  NICHE: "细分领域",
};

const POSITION_COLORS: Record<string, string> = {
  LEADER: "bg-green-100 text-green-800",
  CHALLENGER: "bg-blue-100 text-blue-800",
  EMERGING: "bg-yellow-100 text-yellow-800",
  NICHE: "bg-gray-100 text-gray-800",
};

export function CompanyPanel({ company, onClose }: CompanyPanelProps) {
  if (!company) return null;

  return (
    <div className="w-96 overflow-y-auto border-l border-gray-200 bg-white p-6">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold">{company.name}</h2>
          {company.ticker && (
            <span className="text-sm text-gray-500">
              {company.exchange}:{company.ticker}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          ✕
        </Button>
      </div>

      {/* Market Position Badge */}
      <span
        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
          POSITION_COLORS[company.marketPosition] ?? ""
        }`}
      >
        {POSITION_LABELS[company.marketPosition] ?? company.marketPosition}
      </span>

      {/* Main Business */}
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-gray-700">主营业务</h3>
        <p className="mt-1 text-sm text-gray-600">{company.mainBusiness}</p>
      </div>

      {/* Core Products */}
      {company.coreProducts.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-700">核心产品</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {company.coreProducts.map((product) => (
              <span
                key={product}
                className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
              >
                {product}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Financials */}
      {(company.revenue || company.marketCap) && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-700">财务指标</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {company.marketCap && (
              <MetricCard label="市值" value={company.marketCap} />
            )}
            {company.revenue && (
              <MetricCard label="营收" value={company.revenue} />
            )}
            {company.revenueGrowth && (
              <MetricCard label="营收增速" value={company.revenueGrowth} />
            )}
            {company.grossMargin && (
              <MetricCard label="毛利率" value={company.grossMargin} />
            )}
            {company.netMargin && (
              <MetricCard label="净利率" value={company.netMargin} />
            )}
            {company.roe && <MetricCard label="ROE" value={company.roe} />}
            {company.marketShare && (
              <MetricCard label="市场份额" value={company.marketShare} />
            )}
          </div>
        </div>
      )}

      {/* Competitive */}
      {company.moat && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-700">护城河</h3>
          <p className="mt-1 text-sm text-gray-600">{company.moat}</p>
        </div>
      )}

      {/* Investment Highlights */}
      {company.highlights.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-700">投资亮点</h3>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {company.highlights.map((h, i) => (
              <li key={i} className="text-sm text-gray-600">
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Risks */}
      {company.risks.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-700">风险提示</h3>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {company.risks.map((r, i) => (
              <li key={i} className="text-sm text-red-600">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Analyst Rating */}
      {company.analystRating && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-700">综合评级</h3>
          <span className="mt-1 inline-block rounded bg-indigo-100 px-2 py-0.5 text-sm font-medium text-indigo-800">
            {company.analystRating}
          </span>
        </div>
      )}

      {/* Competitors */}
      {company.competitors.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-700">主要竞争对手</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {company.competitors.map((c) => (
              <span
                key={c}
                className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-gray-50 p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-900">{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/company-panel.tsx
git commit -m "feat: add company detail side panel with financial metrics and analysis"
```

---

### Task 4: Search and Filter Functionality

**Files:**
- Create: `src/hooks/use-tree-search.ts`
- Create: `src/components/search-bar.tsx`

- [ ] **Step 1: Create search/filter hook**

Create `src/hooks/use-tree-search.ts`:

```typescript
"use client";

import { useState, useMemo, useCallback } from "react";
import { flattenTree, type TreeNode } from "@/lib/tree-utils";
import type { Company, MarketPosition } from "@prisma/client";

export interface TreeFilters {
  query: string;
  nodeTypes: Set<string>;
  marketPositions: Set<string>;
  publicOnly: boolean;
}

const EMPTY_FILTERS: TreeFilters = {
  query: "",
  nodeTypes: new Set(),
  marketPositions: new Set(),
  publicOnly: false,
};

export function useTreeSearch(root: TreeNode | null) {
  const [filters, setFilters] = useState<TreeFilters>(EMPTY_FILTERS);

  const allNodes = useMemo(() => {
    if (!root) return [];
    return flattenTree(root);
  }, [root]);

  const highlightedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!filters.query && filters.nodeTypes.size === 0 && !filters.publicOnly) {
      return ids;
    }

    const queryLower = filters.query.toLowerCase();

    for (const node of allNodes) {
      let matches = true;

      // Text search: match node name or company names
      if (queryLower) {
        const nameMatch = node.name.toLowerCase().includes(queryLower);
        const companyMatch = node.data.companies?.some(
          (c) =>
            c.name.toLowerCase().includes(queryLower) ||
            c.ticker?.toLowerCase().includes(queryLower)
        );
        if (!nameMatch && !companyMatch) {
          matches = false;
        }
      }

      // Node type filter
      if (
        filters.nodeTypes.size > 0 &&
        !filters.nodeTypes.has(node.data.nodeType)
      ) {
        matches = false;
      }

      if (matches) {
        ids.add(node.data.id);
      }
    }

    return ids;
  }, [allNodes, filters]);

  const searchResults = useMemo(() => {
    if (!filters.query) return [];

    const queryLower = filters.query.toLowerCase();
    const results: Array<{
      type: "node" | "company";
      nodeId: string;
      name: string;
      detail?: string;
    }> = [];

    for (const node of allNodes) {
      if (node.name.toLowerCase().includes(queryLower)) {
        results.push({
          type: "node",
          nodeId: node.data.id,
          name: node.name,
          detail: node.data.nodeType,
        });
      }
      for (const company of node.data.companies ?? []) {
        if (
          company.name.toLowerCase().includes(queryLower) ||
          company.ticker?.toLowerCase().includes(queryLower)
        ) {
          results.push({
            type: "company",
            nodeId: node.data.id,
            name: company.name,
            detail: company.ticker ?? undefined,
          });
        }
      }
    }

    return results.slice(0, 20); // Limit to 20 results
  }, [allNodes, filters.query]);

  const setQuery = useCallback((query: string) => {
    setFilters((prev) => ({ ...prev, query }));
  }, []);

  const toggleNodeType = useCallback((nodeType: string) => {
    setFilters((prev) => {
      const next = new Set(prev.nodeTypes);
      if (next.has(nodeType)) next.delete(nodeType);
      else next.add(nodeType);
      return { ...prev, nodeTypes: next };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  return {
    filters,
    setQuery,
    toggleNodeType,
    clearFilters,
    highlightedNodeIds,
    searchResults,
  };
}
```

- [ ] **Step 2: Create search bar component**

Create `src/components/search-bar.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchResult {
  type: "node" | "company";
  nodeId: string;
  name: string;
  detail?: string;
}

interface SearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  results: SearchResult[];
  onResultClick: (nodeId: string) => void;
  onClear: () => void;
  activeNodeTypes: Set<string>;
  onToggleNodeType: (nodeType: string) => void;
}

const NODE_TYPE_OPTIONS = [
  { value: "UPSTREAM", label: "上游", color: "bg-red-100 text-red-700" },
  { value: "MIDSTREAM", label: "中游", color: "bg-yellow-100 text-yellow-700" },
  {
    value: "DOWNSTREAM",
    label: "下游",
    color: "bg-green-100 text-green-700",
  },
];

export function SearchBar({
  query,
  onQueryChange,
  results,
  onResultClick,
  onClear,
  activeNodeTypes,
  onToggleNodeType,
}: SearchBarProps) {
  const [showResults, setShowResults] = useState(false);

  return (
    <div className="absolute left-4 top-4 z-10 w-72">
      <div className="relative">
        <Input
          placeholder="搜索环节或公司..."
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => setShowResults(true)}
          className="bg-white pr-8 shadow-sm"
        />
        {query && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            onClick={() => {
              onClear();
              setShowResults(false);
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Filter pills */}
      <div className="mt-2 flex gap-1">
        {NODE_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
              activeNodeTypes.has(opt.value)
                ? opt.color
                : "bg-white text-gray-500 hover:bg-gray-100"
            } border`}
            onClick={() => onToggleNodeType(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Search results dropdown */}
      {showResults && results.length > 0 && (
        <div className="mt-1 max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {results.map((result, i) => (
            <button
              key={`${result.nodeId}-${i}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
              onClick={() => {
                onResultClick(result.nodeId);
                setShowResults(false);
              }}
            >
              <span
                className={`text-xs ${
                  result.type === "company" ? "text-blue-500" : "text-gray-400"
                }`}
              >
                {result.type === "company" ? "公司" : "环节"}
              </span>
              <span className="flex-1 truncate font-medium">{result.name}</span>
              {result.detail && (
                <span className="text-xs text-gray-400">{result.detail}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-tree-search.ts src/components/search-bar.tsx
git commit -m "feat: add search and filter functionality for tree visualization"
```

---

### Task 5: Wire Tree View to Project Page

**Files:**
- Modify: `src/app/app/projects/[id]/page.tsx`

- [ ] **Step 1: Update project page with real tree view**

Replace `src/app/app/projects/[id]/page.tsx`:

```tsx
"use client";

import { use, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { GenerationProgress } from "@/components/generation-progress";
import { IndustryTree } from "@/components/tree/industry-tree";
import { CompanyPanel } from "@/components/company-panel";
import { SearchBar } from "@/components/search-bar";
import { useTreeSearch } from "@/hooks/use-tree-search";
import { chainNodesToHierarchy } from "@/lib/tree-utils";
import type { Company } from "@prisma/client";

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  // TODO: get teamId from team context/session
  const teamId = "";

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [nodeCompanies, setNodeCompanies] = useState<Company[]>([]);
  const [generating, setGenerating] = useState(false);

  // Fetch generation results
  const { data: results } = trpc.generation.results.useQuery(
    { teamId, projectId },
    { enabled: !!teamId }
  );

  // Build tree for search
  const treeRoot =
    results?.chain?.nodes && results.project
      ? chainNodesToHierarchy(
          results.chain.nodes as any,
          results.project.industry
        )
      : null;

  const {
    filters,
    setQuery,
    toggleNodeType,
    clearFilters,
    highlightedNodeIds,
    searchResults,
  } = useTreeSearch(treeRoot);

  const startGeneration = trpc.generation.start.useMutation({
    onSuccess: () => setGenerating(false),
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
    startGeneration.mutate({ teamId, projectId, maxDepth: 3 });
  };

  const handleNodeSelect = useCallback(
    (nodeId: string, companies: Company[]) => {
      setSelectedNodeId(nodeId);
      setNodeCompanies(companies);
      setSelectedCompany(null);
    },
    []
  );

  const handleSearchResultClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const chainNodes = results?.chain?.nodes as any[] | undefined;
  const hasData = chainNodes && chainNodes.length > 0;

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex flex-1 flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h1 className="text-lg font-bold">
            {results?.project?.name ?? "项目详情"}
          </h1>
          <div className="flex items-center gap-3">
            {teamId && (
              <GenerationProgress teamId={teamId} projectId={projectId} />
            )}
            <Button
              onClick={handleGenerate}
              disabled={generating || !teamId}
              size="sm"
            >
              {generating ? "正在启动..." : hasData ? "重新生成" : "生成产业链"}
            </Button>
          </div>
        </div>

        {/* Tree visualization */}
        <div className="relative flex-1">
          {hasData ? (
            <>
              <SearchBar
                query={filters.query}
                onQueryChange={setQuery}
                results={searchResults}
                onResultClick={handleSearchResultClick}
                onClear={clearFilters}
                activeNodeTypes={filters.nodeTypes}
                onToggleNodeType={toggleNodeType}
              />
              <IndustryTree
                nodes={chainNodes}
                industryName={results!.project.industry}
                selectedNodeId={selectedNodeId}
                highlightedNodeIds={highlightedNodeIds}
                onNodeSelect={handleNodeSelect}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-gray-400">
                  {teamId
                    ? "点击「生成产业链」开始分析"
                    : "请先选择团队以开始分析"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Node companies list (when node is selected but no specific company) */}
      {selectedNodeId && !selectedCompany && nodeCompanies.length > 0 && (
        <div className="w-72 overflow-y-auto border-l border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">公司列表</h3>
            <button
              className="text-sm text-gray-400 hover:text-gray-600"
              onClick={() => {
                setSelectedNodeId(null);
                setNodeCompanies([]);
              }}
            >
              ✕
            </button>
          </div>
          <div className="space-y-2">
            {nodeCompanies.map((company) => (
              <button
                key={company.id}
                className="w-full rounded-lg border border-gray-200 p-3 text-left transition-colors hover:bg-gray-50"
                onClick={() => setSelectedCompany(company)}
              >
                <div className="font-medium">{company.name}</div>
                {company.ticker && (
                  <div className="text-xs text-gray-500">{company.ticker}</div>
                )}
                <div className="mt-1 text-xs text-gray-400">
                  {company.mainBusiness}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Company detail panel */}
      {selectedCompany && (
        <CompanyPanel
          company={selectedCompany}
          onClose={() => setSelectedCompany(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/app/projects/[id]/page.tsx
git commit -m "feat: wire tree visualization and company panel to project page"
```

---

### Task 6: Right-Click Context Menu

**Files:**
- Create: `src/components/node-context-menu.tsx`
- Modify: `src/components/tree/tree-node.tsx` (add right-click handler)

- [ ] **Step 1: Create context menu component**

Create `src/components/node-context-menu.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";

interface ContextMenuItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface NodeContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function NodeContextMenu({
  x,
  y,
  items,
  onClose,
}: NodeContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
            item.disabled
              ? "cursor-not-allowed text-gray-300"
              : item.destructive
                ? "text-red-600 hover:bg-red-50"
                : "text-gray-700 hover:bg-gray-50"
          }`}
          onClick={() => {
            if (!item.disabled) {
              item.onClick();
              onClose();
            }
          }}
          disabled={item.disabled}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add onContextMenu prop to TreeNodeComponent**

In `src/components/tree/tree-node.tsx`, add an `onNodeContextMenu` prop to the interface and wire it to the `<g>` element's `onContextMenu`:

```typescript
// Add to TreeNodeComponentProps interface:
onNodeContextMenu?: (
  node: HierarchyPointNode<TreeNode>,
  event: React.MouseEvent
) => void;

// Add to the <g> element:
onContextMenu={(e) => {
  e.preventDefault();
  e.stopPropagation();
  onNodeContextMenu?.(node, e);
}}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/node-context-menu.tsx src/components/tree/tree-node.tsx
git commit -m "feat: add right-click context menu for tree nodes"
```

---

### Task 7: Run All Tests and Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass (17 existing + tree-utils tests)

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
npm test && npm run build
```

---

## Phase 3 Complete

After completing all 7 tasks, you have:

- D3.js v7 installed with React wrapper components
- Data transformation layer (flat ChainNode[] to D3 hierarchy)
- Interactive horizontal tree with expand/collapse, zoom/pan
- Color-coded nodes by type (upstream/midstream/downstream) with key metrics
- Company count badges on leaf nodes
- Company detail side panel with financials, competitive analysis, investment highlights
- Search bar with text search and node type filters
- Right-click context menu for node operations
- Zoom controls (zoom in/out, fit-to-screen, reset)
- Project page fully wired with tree + company panel + search

**Next:** Phase 4 (Real-time Collaboration) will add multi-user editing with Yjs.
