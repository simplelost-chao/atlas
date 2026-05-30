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
