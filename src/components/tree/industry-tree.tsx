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

const NODE_SPACING_X = 280; // horizontal spacing between levels
const NODE_SPACING_Y = 85; // vertical spacing between siblings

export function IndustryTree({
  nodes,
  industryName,
  selectedNodeId,
  highlightedNodeIds = new Set(),
  onNodeSelect,
}: IndustryTreeProps) {
  const { svgRef, gRef, zoomIn, zoomOut, resetZoom, fitToScreen, centerAt1to1, centerOnPoint } =
    useTreeZoom();

  // Track which node was just toggled, to focus on it
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  // Build the tree hierarchy
  const rootData = useMemo(
    () => chainNodesToHierarchy(nodes, industryName),
    [nodes, industryName]
  );

  // Default: collapse all nodes at level >= 1 (only show root + first-level)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    for (const node of nodes) {
      if (node.level >= 1) {
        // Check if this node has children
        const hasChildren = nodes.some((n: any) => n.parentId === node.id);
        if (hasChildren) ids.add(node.id);
      }
    }
    return ids;
  });

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

  // On initial render, center at 1:1
  useEffect(() => {
    const timer = setTimeout(centerAt1to1, 150);
    return () => clearTimeout(timer);
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After collapse/expand, focus on the toggled node
  useEffect(() => {
    if (!focusNodeId) return;
    const timer = setTimeout(() => {
      const targetNode = layoutNodes.find((n) => n.data.data.id === focusNodeId);
      if (targetNode) {
        // In D3 tree layout, node.y = horizontal position, node.x = vertical position
        centerOnPoint(targetNode.y, targetNode.x);
      }
      setFocusNodeId(null);
    }, 200);
    return () => clearTimeout(timer);
  }, [focusNodeId, layoutNodes, centerOnPoint]);

  const handleNodeClick = useCallback(
    (node: HierarchyPointNode<TreeNode>) => {
      const nodeData = node.data;
      onNodeSelect?.(nodeData.data.id, nodeData.data.companies ?? []);
      // Center on clicked node
      centerOnPoint(node.y, node.x);
    },
    [onNodeSelect, centerOnPoint]
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
      // Focus on this node after layout recalculates
      setFocusNodeId(nodeId);
    },
    []
  );

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-gray-200 bg-[#F3F4F6]">
      <svg ref={svgRef} className="h-full w-full touch-none">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow
              dx="0"
              dy="2"
              stdDeviation="3"
              floodOpacity="0.3"
            />
          </filter>
        </defs>
        <g ref={gRef}>
          {/* Links */}
          {layoutLinks.map((link, i) => (
            <TreeLinkComponent key={`link-${i}`} link={link} />
          ))}

          {/* Nodes */}
          {layoutNodes.map((node) => {
            // Count how many direct children this node has (for collapsed badge)
            const childCount = collapsedIds.has(node.data.data.id)
              ? nodes.filter((n: any) => n.parentId === node.data.data.id).length
              : undefined;
            return (
              <TreeNodeComponent
                key={node.data.data.id}
                node={node}
                isSelected={selectedNodeId === node.data.data.id}
                isHighlighted={highlightedNodeIds.has(node.data.data.id)}
                collapsedChildCount={childCount}
                onNodeClick={handleNodeClick}
                onNodeToggle={handleNodeToggle}
              />
            );
          })}
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
