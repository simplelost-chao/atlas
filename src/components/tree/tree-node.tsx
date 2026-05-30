"use client";

import type { HierarchyPointNode } from "d3";
import type { TreeNode, TreeNodeData } from "@/lib/tree-utils";

interface TreeNodeComponentProps {
  node: HierarchyPointNode<TreeNode>;
  isSelected: boolean;
  isHighlighted: boolean;
  /** Total children count (including collapsed) for showing badge */
  collapsedChildCount?: number;
  onNodeClick: (node: HierarchyPointNode<TreeNode>) => void;
  onNodeToggle: (node: HierarchyPointNode<TreeNode>) => void;
  onNodeContextMenu?: (
    node: HierarchyPointNode<TreeNode>,
    event: React.MouseEvent
  ) => void;
}

const NODE_TYPE_COLORS: Record<string, string> = {
  ROOT: "#C59D5F",
  UPSTREAM: "#ef4444",
  MIDSTREAM: "#f59e0b",
  DOWNSTREAM: "#22c55e",
};

const NODE_TYPE_LABELS: Record<string, string> = {
  UPSTREAM: "上游",
  MIDSTREAM: "中游",
  DOWNSTREAM: "下游",
};

const NODE_WIDTH = 200;
const NODE_HEIGHT = 74;

export function TreeNodeComponent({
  node,
  isSelected,
  isHighlighted,
  collapsedChildCount,
  onNodeClick,
  onNodeToggle,
  onNodeContextMenu,
}: TreeNodeComponentProps) {
  const { data } = node;
  const color = NODE_TYPE_COLORS[data.data.nodeType] ?? "#6b7280";
  const isCollapsed = !!node.data._collapsed;
  const hasChildren = isCollapsed || (node.children && node.children.length > 0);
  const companyCount = data.data.companies?.length ?? 0;
  const typeLabel = NODE_TYPE_LABELS[data.data.nodeType];

  return (
    <g
      transform={`translate(${node.y},${node.x})`}
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onNodeClick(node);
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
        fill="#1F2937"
        stroke={isSelected ? "#C59D5F" : isHighlighted ? "#fbbf24" : color}
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

      {/* Type label badge */}
      {typeLabel && (
        <g transform={`translate(${NODE_WIDTH / 2 - 28}, ${-NODE_HEIGHT / 2 + 12})`}>
          <rect x={-14} y={-8} width={28} height={16} rx={4} fill={color} opacity={0.2} />
          <text fontSize="9" fill={color} textAnchor="middle" dy="0.35em" fontWeight="600">
            {typeLabel}
          </text>
        </g>
      )}

      {/* Node name */}
      <text
        dy="-0.2em"
        x={-NODE_WIDTH / 2 + 14}
        fontSize="13"
        fontWeight="600"
        fill="#F9FAFB"
        textAnchor="start"
      >
        {data.name.length > 14 ? data.name.slice(0, 14) + "..." : data.name}
      </text>

      {/* Metrics row */}
      <text
        dy="1.4em"
        x={-NODE_WIDTH / 2 + 14}
        fontSize="10"
        fill="#9CA3AF"
        textAnchor="start"
      >
        {[
          data.data.profitMargin && `利润率:${data.data.profitMargin}`,
          companyCount > 0 && `${companyCount}家公司`,
        ]
          .filter(Boolean)
          .join(" | ")}
        {!data.data.profitMargin &&
          !companyCount &&
          data.data.marketSize &&
          `规模: ${data.data.marketSize}`}
      </text>

      {/* Expand/collapse button */}
      {hasChildren && (
        <g
          transform={`translate(${NODE_WIDTH / 2 + 14}, 0)`}
          className="cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onNodeToggle(node);
          }}
        >
          <circle r={12} fill="#374151" stroke={color} strokeWidth={1.5} />
          {isCollapsed ? (
            <>
              <text fontSize="12" fill={color} textAnchor="middle" dy="0.35em" fontWeight="bold">
                +
              </text>
              {/* Child count */}
              {collapsedChildCount != null && collapsedChildCount > 0 && (
                <text fontSize="8" fill={color} textAnchor="middle" dy="2.2em">
                  {collapsedChildCount}
                </text>
              )}
            </>
          ) : (
            <text fontSize="12" fill={color} textAnchor="middle" dy="0.35em" fontWeight="bold">
              −
            </text>
          )}
        </g>
      )}
    </g>
  );
}

export { NODE_WIDTH, NODE_HEIGHT };
