"use client";

import type { HierarchyPointNode } from "d3";
import type { TreeNode, TreeNodeData } from "@/lib/tree-utils";

interface TreeNodeComponentProps {
  node: HierarchyPointNode<TreeNode>;
  isSelected: boolean;
  isHighlighted: boolean;
  onNodeClick: (node: HierarchyPointNode<TreeNode>) => void;
  onNodeToggle: (node: HierarchyPointNode<TreeNode>) => void;
  onNodeContextMenu?: (
    node: HierarchyPointNode<TreeNode>,
    event: React.MouseEvent
  ) => void;
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
  onNodeContextMenu,
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
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onNodeContextMenu?.(node, e);
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
