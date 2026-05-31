"use client";

import { use, useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { GenerationProgress } from "@/components/generation-progress";
import { CompanyPanel } from "@/components/company-panel";
import { IndustryTree } from "@/components/tree/industry-tree";
import { useTeam } from "@/hooks/use-team";
import type { Company } from "@prisma/client";

type ViewMode = "folder" | "tree";

const POSITION_LABELS: Record<string, string> = {
  LEADER: "龙头",
  CHALLENGER: "挑战者",
  EMERGING: "新兴",
  NICHE: "细分",
};
const POSITION_COLORS: Record<string, string> = {
  LEADER: "bg-green-600 text-white",
  CHALLENGER: "bg-blue-600 text-white",
  EMERGING: "bg-amber-500 text-white",
  NICHE: "bg-gray-500 text-white",
};
const NODE_TYPE_COLORS: Record<string, string> = {
  UPSTREAM: "border-l-red-500",
  MIDSTREAM: "border-l-amber-500",
  DOWNSTREAM: "border-l-green-500",
};
const NODE_TYPE_LABELS: Record<string, string> = {
  UPSTREAM: "上游",
  MIDSTREAM: "中游",
  DOWNSTREAM: "下游",
};

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const { teamId: rawTeamId } = useTeam();
  const teamId = rawTeamId ?? "";

  const PAGE_SIZE = 30;
  const [viewMode, setViewMode] = useState<ViewMode>("folder");
  // Folder view state
  const [path, setPath] = useState<string[]>([]);
  const [companyPage, setCompanyPage] = useState(0);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [generating, setGenerating] = useState(false);
  // Tree view state
  const [treeSelectedNodeId, setTreeSelectedNodeId] = useState<string | null>(null);
  const [treeNodeCompanies, setTreeNodeCompanies] = useState<Company[]>([]);

  const { data: results, refetch: refetchResults } = trpc.generation.results.useQuery(
    { teamId, projectId },
    { enabled: !!teamId }
  );

  const backfill = trpc.generation.backfill.useMutation({
    onSuccess: (data) => {
      if (data.status === "nothing_to_do") return;
      const interval = setInterval(() => refetchResults(), 3000);
      setTimeout(() => clearInterval(interval), 600_000);
    },
  });

  const expandNode = trpc.generation.expandNode.useMutation({
    onSuccess: () => {
      const interval = setInterval(() => refetchResults(), 3000);
      setTimeout(() => clearInterval(interval), 120_000);
    },
  });

  const startGeneration = trpc.generation.start.useMutation({
    onSuccess: () => {
      setGenerating(false);
      setPath([]);
      setSelectedCompany(null);
      const interval = setInterval(async () => {
        const fresh = await refetchResults();
        const status = (fresh.data?.chain as any)?.status;
        if (status === "COMPLETED" || status === "FAILED") clearInterval(interval);
      }, 3000);
      setTimeout(() => clearInterval(interval), 600_000);
    },
    onError: (err) => {
      setGenerating(false);
      alert(err.message);
    },
  });

  const chainNodes = results?.chain?.nodes as any[] | undefined;
  const hasData = chainNodes && chainNodes.length > 0;

  // Current node ID (last in path, or null for root)
  const currentNodeId = path.length > 0 ? path[path.length - 1] : null;

  // Current node detail
  const currentNode = useMemo(() => {
    if (!currentNodeId || !chainNodes) return null;
    return chainNodes.find((n: any) => n.id === currentNodeId);
  }, [currentNodeId, chainNodes]);

  // Children of current node
  const childNodes = useMemo(() => {
    if (!chainNodes) return [];
    return chainNodes
      .filter((n: any) => {
        if (currentNodeId === null) return n.parentId === null;
        return n.parentId === currentNodeId;
      })
      .sort((a: any, b: any) => a.order - b.order);
  }, [chainNodes, currentNodeId]);

  // Companies of current node
  const currentCompanies = useMemo(() => {
    if (!currentNode) return [];
    return (currentNode.companies ?? [])
      .slice()
      .sort((a: Company, b: Company) => {
        const score = (c: Company) => {
          let s = 0;
          if (c.marketPosition === "LEADER") s += 3;
          if (c.marketPosition === "NICHE") s += 2;
          if (c.moat) s += 2;
          if (c.highlights?.length) s += 1;
          return s;
        };
        return score(b) - score(a);
      });
  }, [currentNode]);

  // Breadcrumb path with names
  const breadcrumbs = useMemo(() => {
    if (!chainNodes) return [];
    return path.map((id) => {
      const node = chainNodes.find((n: any) => n.id === id);
      return { id, name: node?.name ?? "?" };
    });
  }, [path, chainNodes]);

  // Has children check for a node
  const hasChildren = (nodeId: string) => {
    return chainNodes?.some((n: any) => n.parentId === nodeId) ?? false;
  };

  // Tree view: handle node select
  const handleTreeNodeSelect = useCallback(
    (nodeId: string, companies: Company[]) => {
      setTreeSelectedNodeId(nodeId);
      setTreeNodeCompanies(companies);
      setSelectedCompany(null);
    },
    []
  );

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
              onClick={() => { if (teamId) backfill.mutate({ teamId, projectId }); }}
              className="border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              {backfill.isPending ? "补全中..." : "补全公司"}
            </Button>
          )}
          {!hasData && (
            <Button
              onClick={() => { setGenerating(true); startGeneration.mutate({ teamId, projectId, maxDepth: 2 }); }}
              disabled={generating || !teamId}
              size="sm"
              className="bg-[#C59D5F] text-white hover:bg-[#D4AD6F]"
            >
              {generating ? "正在启动..." : "生成产业链"}
            </Button>
          )}
        </div>
      </div>

      {/* Generation progress */}
      {teamId && (
        <div className="shrink-0 border-b border-gray-200 px-4 py-3">
          <GenerationProgress teamId={teamId} projectId={projectId} />
        </div>
      )}

      {/* View mode tabs */}
      {hasData && !selectedCompany && (
        <div className="flex shrink-0 border-b border-gray-200 bg-white px-4">
          <button
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              viewMode === "folder"
                ? "text-[#C59D5F]"
                : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setViewMode("folder")}
          >
            <div className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              目录
            </div>
            {viewMode === "folder" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C59D5F]" />
            )}
          </button>
          <button
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              viewMode === "tree"
                ? "text-[#C59D5F]"
                : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setViewMode("tree")}
          >
            <div className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="5" r="3" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="12" x2="6" y2="16" />
                <line x1="12" y1="12" x2="18" y2="16" />
                <circle cx="6" cy="19" r="3" />
                <circle cx="18" cy="19" r="3" />
              </svg>
              树状图
            </div>
            {viewMode === "tree" && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C59D5F]" />
            )}
          </button>
        </div>
      )}

      {!hasData ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <p className="text-gray-400">
            {teamId ? "点击「生成产业链」开始分析" : "请先选择团队以开始分析"}
          </p>
        </div>
      ) : selectedCompany ? (
        /* Company detail view */
        <div className="flex-1 overflow-y-auto bg-white p-4 md:p-6">
          <button
            className="mb-4 text-sm text-[#C59D5F] hover:underline"
            onClick={() => setSelectedCompany(null)}
          >
            ← 返回
          </button>
          <CompanyPanel company={selectedCompany} onClose={() => setSelectedCompany(null)} />
        </div>
      ) : viewMode === "tree" ? (
        /* Tree view */
        <div className="flex flex-1 flex-col">
          <div className="relative shrink-0 h-[300px] md:h-[500px]">
            <IndustryTree
              nodes={chainNodes}
              industryName={results!.project.industry}
              selectedNodeId={treeSelectedNodeId}
              onNodeSelect={handleTreeNodeSelect}
            />
          </div>
          {treeNodeCompanies.length > 0 && (
            <div className="flex-1 overflow-y-auto border-t border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                相关公司 ({treeNodeCompanies.length})
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {treeNodeCompanies.map((company) => (
                  <button
                    key={company.id}
                    className="rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-[#C59D5F] hover:shadow-md"
                    onClick={() => setSelectedCompany(company)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900 truncate text-sm">{company.name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${POSITION_COLORS[company.marketPosition] ?? "bg-gray-500 text-white"}`}>
                        {POSITION_LABELS[company.marketPosition] ?? company.marketPosition}
                      </span>
                    </div>
                    {company.ticker && <div className="text-xs text-gray-400">{company.exchange}:{company.ticker}</div>}
                    <p className="mt-1 text-xs text-gray-500 line-clamp-1">{company.mainBusiness}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Folder browser */
        <div className="flex-1 overflow-y-auto bg-[#F3F4F6]">
          {/* Breadcrumb */}
          <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-gray-200 bg-white px-4 py-2.5 text-sm overflow-x-auto">
            <button
              className={`shrink-0 hover:text-[#C59D5F] ${path.length === 0 ? "font-semibold text-gray-900" : "text-gray-500"}`}
              onClick={() => setPath([])}
            >
              {results?.project?.industry ?? "根目录"}
            </button>
            {breadcrumbs.map((bc, i) => (
              <span key={bc.id} className="flex items-center gap-1 shrink-0">
                <span className="text-gray-300">/</span>
                <button
                  className={`hover:text-[#C59D5F] ${i === breadcrumbs.length - 1 ? "font-semibold text-gray-900" : "text-gray-500"}`}
                  onClick={() => setPath(path.slice(0, i + 1))}
                >
                  {bc.name}
                </button>
              </span>
            ))}
          </div>

          {/* Current node info (if not root) */}
          {currentNode && (() => {
            const nodeCompanies: Company[] = currentNode.companies ?? [];
            const leaders = nodeCompanies.filter((c: Company) => c.marketPosition === "LEADER");
            const withMoat = nodeCompanies.filter((c: Company) => c.moat);
            const totalCompaniesInBranch = chainNodes!.filter((n: any) => {
              // Count companies in this node and all descendants
              let current = n;
              while (current) {
                if (current.id === currentNode.id) return true;
                current = chainNodes!.find((p: any) => p.id === current.parentId);
              }
              return false;
            }).reduce((sum: number, n: any) => sum + (n.companies?.length ?? 0), 0);
            const subNodeCount = chainNodes!.filter((n: any) => n.parentId === currentNode.id).length;

            // Priority level based on Serenity framework
            const hasCriticalRole = currentNode.nodeType === "UPSTREAM";
            const hasHighMargin = currentNode.profitMargin && parseInt(currentNode.profitMargin) >= 30;
            const hasChokepoints = withMoat.length > 0 || leaders.length > 0;
            const priorityLevel = (hasCriticalRole ? 2 : 0) + (hasHighMargin ? 1 : 0) + (hasChokepoints ? 2 : 0);
            const priorityLabel = priorityLevel >= 4 ? "高优先级" : priorityLevel >= 2 ? "中优先级" : "一般";
            const priorityColor = priorityLevel >= 4 ? "bg-[#C59D5F]/10 text-[#C59D5F] border-[#C59D5F]/30" : priorityLevel >= 2 ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-gray-50 text-gray-500 border-gray-200";

            return (
              <div className="border-b border-gray-200 bg-white px-4 py-4">
                {/* Title + actions */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-semibold text-gray-900">{currentNode.name}</h2>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        currentNode.nodeType === "UPSTREAM" ? "bg-red-50 text-red-600" :
                        currentNode.nodeType === "DOWNSTREAM" ? "bg-green-50 text-green-600" :
                        "bg-amber-50 text-amber-600"
                      }`}>
                        {NODE_TYPE_LABELS[currentNode.nodeType] ?? currentNode.nodeType}
                      </span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${priorityColor}`}>
                        {priorityLabel}
                      </span>
                    </div>
                  </div>
                  {!hasChildren(currentNode.id) && (
                    <Button size="sm" variant="outline" disabled={expandNode.isPending}
                      onClick={() => { if (teamId) expandNode.mutate({ teamId, nodeId: currentNode.id }); }}
                      className="shrink-0 border-gray-300 text-gray-700">
                      {expandNode.isPending ? "挖掘中..." : "继续挖掘 ↓"}
                    </Button>
                  )}
                </div>

                {/* Description */}
                <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">{currentNode.description}</p>

                {/* Metrics grid */}
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {currentNode.profitMargin && (
                    <div className="rounded bg-gray-50 border border-gray-100 px-3 py-2">
                      <div className="text-[10px] text-gray-400">利润率</div>
                      <div className="text-sm font-semibold text-gray-900">{currentNode.profitMargin}</div>
                    </div>
                  )}
                  {currentNode.marketSize && (
                    <div className="rounded bg-gray-50 border border-gray-100 px-3 py-2">
                      <div className="text-[10px] text-gray-400">市场规模</div>
                      <div className="text-sm font-semibold text-gray-900">{currentNode.marketSize}</div>
                    </div>
                  )}
                  {currentNode.growthTrend && (
                    <div className="rounded bg-gray-50 border border-gray-100 px-3 py-2">
                      <div className="text-[10px] text-gray-400">增长趋势</div>
                      <div className="text-sm font-semibold text-gray-900">{currentNode.growthTrend}</div>
                    </div>
                  )}
                  {currentNode.valueFlow && (
                    <div className="rounded bg-gray-50 border border-gray-100 px-3 py-2">
                      <div className="text-[10px] text-gray-400">价值流转</div>
                      <div className="text-xs text-gray-700 line-clamp-2">{currentNode.valueFlow}</div>
                    </div>
                  )}
                </div>

                {/* Summary stats */}
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                  {subNodeCount > 0 && <span>{subNodeCount} 个子环节</span>}
                  <span>{nodeCompanies.length} 家直属公司</span>
                  {totalCompaniesInBranch > nodeCompanies.length && <span>分支下共 {totalCompaniesInBranch} 家</span>}
                  {leaders.length > 0 && <span className="text-green-600">{leaders.length} 家龙头</span>}
                  {withMoat.length > 0 && <span className="text-[#C59D5F]">{withMoat.length} 家有护城河</span>}
                </div>

                {/* Key drivers */}
                {currentNode.keyDrivers?.length > 0 && (
                  <div className="mt-3">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider">核心驱动因素</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {currentNode.keyDrivers.map((d: string, i: number) => (
                        <span key={i} className="rounded-full bg-blue-50 border border-blue-100 px-2.5 py-0.5 text-xs text-blue-700">{d}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="p-4 space-y-4">
            {/* Sub-folders (child nodes) */}
            {childNodes.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {currentNodeId ? "子环节" : "产业链环节"} ({childNodes.length})
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {childNodes.map((node: any) => {
                    const nodeChildCount = chainNodes!.filter((n: any) => n.parentId === node.id).length;
                    const companyCount = node.companies?.length ?? 0;
                    return (
                      <button
                        key={node.id}
                        className={`flex items-start gap-3 rounded-lg border border-l-4 bg-white p-3 text-left transition-all hover:shadow-md hover:border-[#C59D5F] ${NODE_TYPE_COLORS[node.nodeType] ?? "border-l-gray-400"}`}
                        onClick={() => { setPath([...path, node.id]); setCompanyPage(0); }}
                      >
                        {/* Folder icon */}
                        <div className="shrink-0 mt-0.5 text-[#C59D5F]">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" opacity="0.8">
                            <path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 truncate">{node.name}</span>
                            <span className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${
                              node.nodeType === "UPSTREAM" ? "bg-red-50 text-red-600" :
                              node.nodeType === "DOWNSTREAM" ? "bg-green-50 text-green-600" :
                              "bg-amber-50 text-amber-600"
                            }`}>
                              {NODE_TYPE_LABELS[node.nodeType] ?? node.nodeType}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{node.description}</p>
                          <div className="mt-1 flex gap-3 text-[11px] text-gray-400">
                            {nodeChildCount > 0 && <span>{nodeChildCount} 个子环节</span>}
                            {companyCount > 0 && <span>{companyCount} 家公司</span>}
                            {node.profitMargin && <span>利润率 {node.profitMargin}</span>}
                          </div>
                        </div>
                        {/* Arrow */}
                        <div className="shrink-0 mt-1 text-gray-300">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Companies in current node */}
            {currentCompanies.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  相关公司 ({currentCompanies.length})
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 items-start">
                  {currentCompanies.slice(companyPage * PAGE_SIZE, (companyPage + 1) * PAGE_SIZE).map((company: Company) => {
                    const isChokepoint =
                      company.moat ||
                      (company.marketPosition === "LEADER" && company.marketShare) ||
                      (company.marketPosition === "NICHE" && company.highlights?.length);

                    return (
                      <button
                        key={company.id}
                        className={`rounded-lg border p-4 text-left transition-all hover:shadow-md ${
                          isChokepoint
                            ? "border-[#C59D5F] bg-[#C59D5F]/5 hover:bg-[#C59D5F]/10"
                            : "border-gray-200 bg-white hover:border-[#C59D5F]"
                        }`}
                        onClick={() => setSelectedCompany(company)}
                      >
                        {/* Header */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              {isChokepoint && <span className="text-[#C59D5F]">★</span>}
                              <span className="font-semibold text-gray-900">{company.name}</span>
                            </div>
                            {company.ticker && (
                              <div className="text-xs text-gray-400 mt-0.5">{company.exchange}:{company.ticker}</div>
                            )}
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${POSITION_COLORS[company.marketPosition] ?? "bg-gray-500 text-white"}`}>
                            {POSITION_LABELS[company.marketPosition] ?? company.marketPosition}
                          </span>
                        </div>

                        {/* Main business */}
                        <p className="text-xs text-gray-600 mb-3">{company.mainBusiness}</p>

                        {/* Financials — one per line */}
                        {(company.marketCap || company.revenue || company.grossMargin) && (
                          <div className="mb-3 rounded border border-gray-100 divide-y divide-gray-100 text-xs">
                            {[
                              { label: "市值", value: company.marketCap },
                              { label: "营收", value: company.revenue },
                              { label: "营收增速", value: company.revenueGrowth },
                              { label: "毛利率", value: company.grossMargin },
                              { label: "净利率", value: company.netMargin },
                              { label: "市场份额", value: company.marketShare },
                            ].filter(f => f.value).map((f) => {
                              // Split value and annotation (stuff in parentheses)
                              const match = f.value!.match(/^([^（(]+)([（(].+[）)])?$/);
                              const mainVal = match ? match[1].trim() : f.value!;
                              const annotation = match?.[2] ?? null;
                              return (
                                <div key={f.label} className="flex justify-between items-center px-3 py-1.5 group">
                                  <span className="text-gray-400">{f.label}</span>
                                  <span className="flex items-center gap-1">
                                    <span className="font-medium text-gray-900">{mainVal}</span>
                                    {annotation && (
                                      <span className="relative">
                                        <span className="cursor-help text-gray-300 hover:text-gray-500 text-xs" title={annotation}>?</span>
                                      </span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Moat — structured if has numbered points */}
                        {company.moat && (
                          <div className="mb-3 rounded bg-[#C59D5F]/5 border border-[#C59D5F]/20 px-3 py-2">
                            <div className="text-[10px] font-semibold text-[#C59D5F] mb-1">护城河</div>
                            {company.moat.includes("（") || company.moat.includes("(") ? (
                              <div className="space-y-1">
                                {company.moat.split(/[;；]|(?=\(\d\))|(?=（\d）)/).filter(Boolean).map((part, i) => (
                                  <p key={i} className="text-xs text-gray-700">{part.trim()}</p>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-700 leading-relaxed">{company.moat}</p>
                            )}
                          </div>
                        )}

                        {/* Highlights */}
                        {company.highlights?.length > 0 && (
                          <div className="mb-3">
                            <div className="text-[10px] font-semibold text-green-600 mb-1.5">投资亮点</div>
                            <div className="space-y-1">
                              {company.highlights.map((h, i) => (
                                <div key={i} className="flex gap-2 rounded bg-green-50 px-2.5 py-1.5 text-xs text-gray-700">
                                  <span className="shrink-0 text-green-500 font-medium">{i + 1}.</span>
                                  <span>{h}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Risks */}
                        {company.risks?.length > 0 && (
                          <div className="mb-3">
                            <div className="text-[10px] font-semibold text-red-500 mb-1.5">风险提示</div>
                            <div className="space-y-1">
                              {company.risks.map((r, i) => (
                                <div key={i} className="flex gap-2 rounded bg-red-50 px-2.5 py-1.5 text-xs text-gray-700">
                                  <span className="shrink-0 text-red-400 font-medium">{i + 1}.</span>
                                  <span>{r}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Rating — color coded */}
                        {company.analystRating && (() => {
                          const rating = company.analystRating;
                          const ratingColor =
                            /买入|强烈/.test(rating) ? "bg-green-600 text-white" :
                            /增持|推荐/.test(rating) ? "bg-green-100 text-green-700 border border-green-200" :
                            /持有|中性/.test(rating) ? "bg-amber-100 text-amber-700 border border-amber-200" :
                            /减持|卖出/.test(rating) ? "bg-red-100 text-red-700 border border-red-200" :
                            "bg-[#C59D5F]/10 text-[#C59D5F] border border-[#C59D5F]/20";
                          return (
                            <div className="pt-2 border-t border-gray-100 flex items-center gap-2">
                              <span className="text-[10px] text-gray-400">评级</span>
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${ratingColor}`}>
                                {rating}
                              </span>
                            </div>
                          );
                        })()}
                      </button>
                    );
                  })}
                </div>

                {/* Pagination */}
                {currentCompanies.length > PAGE_SIZE && (() => {
                  const totalPages = Math.ceil(currentCompanies.length / PAGE_SIZE);
                  return (
                    <div className="mt-4 flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        {companyPage * PAGE_SIZE + 1}-{Math.min((companyPage + 1) * PAGE_SIZE, currentCompanies.length)} / {currentCompanies.length}
                      </span>
                      <div className="flex gap-1">
                        <button
                          disabled={companyPage === 0}
                          onClick={() => setCompanyPage(companyPage - 1)}
                          className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          上一页
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => (
                          <button
                            key={i}
                            onClick={() => setCompanyPage(i)}
                            className={`rounded border px-2.5 py-1 text-xs ${companyPage === i ? "border-[#C59D5F] bg-[#C59D5F]/10 text-[#C59D5F] font-medium" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                          >
                            {i + 1}
                          </button>
                        ))}
                        <button
                          disabled={companyPage >= totalPages - 1}
                          onClick={() => setCompanyPage(companyPage + 1)}
                          className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Empty state */}
            {childNodes.length === 0 && currentCompanies.length === 0 && currentNodeId && (
              <div className="py-12 text-center text-gray-400">
                <p>该环节暂无子环节和公司数据</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={expandNode.isPending}
                  onClick={() => { if (teamId && currentNodeId) expandNode.mutate({ teamId, nodeId: currentNodeId }); }}
                >
                  {expandNode.isPending ? "挖掘中..." : "开始挖掘"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
