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
