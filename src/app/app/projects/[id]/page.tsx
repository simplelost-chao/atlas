"use client";

import { use, useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { GenerationProgress } from "@/components/generation-progress";
import { IndustryTree } from "@/components/tree/industry-tree";
import { CompanyPanel } from "@/components/company-panel";
import { SearchBar } from "@/components/search-bar";
import { useTreeSearch } from "@/hooks/use-tree-search";
import { chainNodesToHierarchy } from "@/lib/tree-utils";
import { useTeam } from "@/hooks/use-team";
import type { Company } from "@prisma/client";

const POSITION_LABELS: Record<string, string> = {
  LEADER: "龙头",
  CHALLENGER: "挑战者",
  EMERGING: "新兴",
  NICHE: "细分",
};
const POSITION_COLORS: Record<string, string> = {
  LEADER: "bg-green-900/50 text-green-400 border-green-800",
  CHALLENGER: "bg-blue-900/50 text-blue-400 border-blue-800",
  EMERGING: "bg-yellow-900/50 text-yellow-400 border-yellow-800",
  NICHE: "bg-[#374151] text-[#9CA3AF] border-[#4B5563]",
};

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const { teamId: rawTeamId } = useTeam();
  const teamId = rawTeamId ?? "";

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeName, setSelectedNodeName] = useState<string>("");
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [nodeCompanies, setNodeCompanies] = useState<Company[]>([]);
  const [generating, setGenerating] = useState(false);
  const [showProgress, setShowProgress] = useState(true);

  // Fetch generation results
  const { data: results, refetch: refetchResults } = trpc.generation.results.useQuery(
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

  const backfill = trpc.generation.backfill.useMutation({
    onSuccess: (data) => {
      if (data.status === "nothing_to_do") {
        alert(data.message);
        return;
      }
      alert(data.message);
      // Poll for updates
      const interval = setInterval(() => refetchResults(), 3000);
      setTimeout(() => clearInterval(interval), 600_000);
    },
    onError: (err) => alert(err.message),
  });

  const expandNode = trpc.generation.expandNode.useMutation({
    onSuccess: () => {
      // Poll for new data every 3s for 2 minutes
      const interval = setInterval(() => refetchResults(), 3000);
      setTimeout(() => clearInterval(interval), 120_000);
    },
    onError: (err) => {
      alert(err.message);
    },
  });

  const startGeneration = trpc.generation.start.useMutation({
    onSuccess: () => {
      setGenerating(false);
      setShowProgress(true);
      setSelectedNodeId(null);
      setNodeCompanies([]);
      setSelectedCompany(null);
      // Poll for updates every 3s until completed/failed
      const interval = setInterval(async () => {
        const fresh = await refetchResults();
        const status = (fresh.data?.chain as any)?.status;
        if (status === "COMPLETED" || status === "FAILED") {
          clearInterval(interval);
        }
      }, 3000);
      setTimeout(() => clearInterval(interval), 600_000);
    },
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
      // Find node name from the tree data
      const node = (results?.chain?.nodes as any[])?.find(
        (n: any) => n.id === nodeId
      );
      setSelectedNodeName(node?.name ?? "");
    },
    [results]
  );

  const handleSearchResultClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const chainNodes = results?.chain?.nodes as any[] | undefined;
  const hasData = chainNodes && chainNodes.length > 0;

  // Find selected node's detail info
  const selectedNodeDetail = useMemo(() => {
    if (!selectedNodeId || !chainNodes) return null;
    return chainNodes.find((n: any) => n.id === selectedNodeId);
  }, [selectedNodeId, chainNodes]);

  // Check if selected node has children (already expanded)
  const selectedNodeHasChildren = useMemo(() => {
    if (!selectedNodeId || !chainNodes) return false;
    return chainNodes.some((n: any) => n.parentId === selectedNodeId);
  }, [selectedNodeId, chainNodes]);

  return (
    <div className="flex min-h-full flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-lg font-bold text-gray-900">
          {results?.project?.name ?? "项目详情"}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {hasData && (
            <Button
              variant="outline"
              size="sm"
              disabled={backfill.isPending || !teamId}
              onClick={() => {
                if (teamId) backfill.mutate({ teamId, projectId });
              }}
              className="border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              {backfill.isPending ? "补全中..." : "补全公司"}
            </Button>
          )}
          <Button
            onClick={handleGenerate}
            disabled={generating || !teamId}
            size="sm"
            className="bg-[#C59D5F] text-white hover:bg-[#D4AD6F]"
          >
            {generating ? "正在启动..." : hasData ? "重新生成" : "生成产业链"}
          </Button>
        </div>
      </div>

      {/* Generation progress — self-collapsible */}
      {teamId && (
        <div className="shrink-0 border-b border-gray-200 px-4 py-3">
          <GenerationProgress teamId={teamId} projectId={projectId} />
        </div>
      )}

      {/* Tree visualization — fixed height, never shrinks */}
      <div className="relative shrink-0 h-[300px] md:h-[500px]">
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
            <p className="text-[#6B7280]">
              {teamId
                ? "点击「生成产业链」开始分析"
                : "请先选择团队以开始分析"}
            </p>
          </div>
        )}
      </div>

      {/* Bottom panel — selected node details + companies */}
      {selectedNodeId && (
        <div className="min-h-[400px] overflow-y-auto border-t border-gray-200 bg-white">
          {/* Node info header */}
          {selectedNodeDetail && (
            <div className="border-b border-gray-100 bg-white px-6 py-3">
              {/* Title row */}
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">{selectedNodeDetail.name}</h2>
                <div className="flex items-center gap-2">
                  {!selectedNodeHasChildren && selectedNodeId !== "industry-root" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={expandNode.isPending}
                      onClick={() => {
                        if (!teamId || !selectedNodeId) return;
                        expandNode.mutate({ teamId, nodeId: selectedNodeId });
                        const interval = setInterval(() => refetchResults(), 3000);
                        setTimeout(() => clearInterval(interval), 180_000);
                      }}
                      className="border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    >
                      {expandNode.isPending ? "挖掘中..." : "继续挖掘 ↓"}
                    </Button>
                  )}
                  {selectedNodeHasChildren && (
                    <span className="rounded bg-[#10B981]/10 px-2 py-1 text-xs text-[#10B981]">已展开</span>
                  )}
                  <button
                    className="text-sm text-gray-400 hover:text-gray-700"
                    onClick={() => {
                      setSelectedNodeId(null);
                      setNodeCompanies([]);
                      setSelectedCompany(null);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {/* Description */}
              <p className="mt-1 text-xs text-gray-500 line-clamp-2">{selectedNodeDetail.description}</p>
              {/* Metrics row */}
              <div className="mt-2 flex flex-wrap gap-4">
                {selectedNodeDetail.profitMargin && (
                  <div>
                    <span className="text-xs text-gray-500">利润率 </span>
                    <span className="text-sm font-medium text-gray-900">{selectedNodeDetail.profitMargin}</span>
                  </div>
                )}
                {selectedNodeDetail.marketSize && (
                  <div>
                    <span className="text-xs text-gray-500">市场规模 </span>
                    <span className="text-sm font-medium text-gray-900">{selectedNodeDetail.marketSize}</span>
                  </div>
                )}
                {selectedNodeDetail.growthTrend && (
                  <div>
                    <span className="text-xs text-gray-500">增长趋势 </span>
                    <span className="text-sm font-medium text-gray-900">{selectedNodeDetail.growthTrend}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Company detail or company list */}
          {selectedCompany ? (
            <div className="p-4">
              <button
                className="mb-3 text-sm text-[#C59D5F] hover:underline"
                onClick={() => setSelectedCompany(null)}
              >
                ← 返回公司列表
              </button>
              <CompanyPanel
                company={selectedCompany}
                onClose={() => setSelectedCompany(null)}
              />
            </div>
          ) : nodeCompanies.length > 0 ? (
            <div className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-500">
                「{selectedNodeName}」相关公司 ({nodeCompanies.length})
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {nodeCompanies.map((company) => (
                  <button
                    key={company.id}
                    className="rounded-lg border border-gray-200 bg-white p-4 text-left transition-all hover:border-[#C59D5F] hover:shadow-md"
                    onClick={() => setSelectedCompany(company)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-gray-900">{company.name}</div>
                        {company.ticker && (
                          <div className="text-xs text-gray-500">
                            {company.exchange}:{company.ticker}
                          </div>
                        )}
                      </div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                          POSITION_COLORS[company.marketPosition] ?? ""
                        }`}
                      >
                        {POSITION_LABELS[company.marketPosition] ?? company.marketPosition}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-500 line-clamp-2">
                      {company.mainBusiness}
                    </p>
                    {(company.revenue || company.marketCap) && (
                      <div className="mt-2 flex gap-3 text-xs text-gray-500">
                        {company.marketCap && <span>市值: {company.marketCap}</span>}
                        {company.revenue && <span>营收: {company.revenue}</span>}
                        {company.grossMargin && <span>毛利率: {company.grossMargin}</span>}
                      </div>
                    )}
                    {company.analystRating && (
                      <div className="mt-2">
                        <span className="rounded bg-[#C59D5F]/10 px-1.5 py-0.5 text-xs font-medium text-[#C59D5F]">
                          {company.analystRating}
                        </span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-gray-500">该环节暂无公司数据</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
