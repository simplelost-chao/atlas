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
