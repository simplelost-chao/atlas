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
