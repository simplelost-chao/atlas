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
