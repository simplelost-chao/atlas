"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTeam } from "@/hooks/use-team";

const POSITION_COLORS: Record<string, string> = {
  LEADER: "bg-green-600 text-white",
  CHALLENGER: "bg-blue-600 text-white",
  EMERGING: "bg-amber-500 text-white",
  NICHE: "bg-gray-500 text-white",
};

const NODE_TYPE_LABELS: Record<string, string> = {
  UPSTREAM: "上游",
  MIDSTREAM: "中游",
  DOWNSTREAM: "下游",
};

const NODE_TYPE_COLORS: Record<string, string> = {
  UPSTREAM: "bg-red-50 text-red-600",
  MIDSTREAM: "bg-amber-50 text-amber-600",
  DOWNSTREAM: "bg-green-50 text-green-600",
};

function formatB(v: number | null, currency = "$"): string {
  if (v == null) return "-";
  if (v >= 1000) return `${currency}${(v / 1000).toFixed(1)}T`;
  if (v >= 1) return `${currency}${v.toFixed(1)}B`;
  return `${currency}${(v * 1000).toFixed(0)}M`;
}

function formatPct(v: number | null): string {
  if (v == null) return "-";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function getRatingColor(rating: string | null): string {
  if (!rating) return "";
  if (/买入|强烈/.test(rating)) return "bg-green-600 text-white";
  if (/增持|推荐/.test(rating)) return "bg-green-100 text-green-700";
  if (/持有|中性/.test(rating)) return "bg-amber-100 text-amber-700";
  if (/减持|卖出/.test(rating)) return "bg-red-100 text-red-700";
  return "bg-[#C59D5F]/10 text-[#C59D5F]";
}

export default function PicksPage() {
  const { teamId } = useTeam();
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: industries } = trpc.picks.industries.useQuery(
    { teamId: teamId! },
    { enabled: !!teamId }
  );

  const { data: picks, isLoading } = trpc.picks.byIndustry.useQuery(
    { teamId: teamId!, industry: selectedIndustry! },
    { enabled: !!teamId && !!selectedIndustry }
  );

  // Auto-select first industry
  if (!selectedIndustry && industries?.length) {
    setSelectedIndustry(industries[0].industry);
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">投资标的推荐</h1>
      <p className="text-sm text-gray-500 mb-5">基于 Chokepoint 评估模型，综合增长性、估值、护城河、现金流等维度筛选</p>

      {/* Industry tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {industries?.map((ind) => (
          <button
            key={ind.industry}
            onClick={() => { setSelectedIndustry(ind.industry); setExpandedId(null); }}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              selectedIndustry === ind.industry
                ? "bg-[#C59D5F] text-white shadow-md"
                : "bg-white text-gray-600 border border-gray-200 hover:border-[#C59D5F]"
            }`}
          >
            {ind.name}
            <span className="ml-1.5 text-xs opacity-70">{String(ind.companyCount)}</span>
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="py-16 text-center text-gray-400">加载中...</div>
      )}

      {/* Picks list */}
      {picks && picks.length > 0 && (
        <div className="space-y-3">
          {picks.map((pick: any, index: number) => {
            const isExpanded = expandedId === pick.id;
            return (
              <div
                key={pick.id}
                className={`rounded-lg border bg-white overflow-hidden transition-all ${
                  index < 5 ? "border-[#C59D5F]/30" : "border-gray-200"
                }`}
              >
                {/* Main row */}
                <button
                  className="w-full text-left px-4 py-3"
                  onClick={() => setExpandedId(isExpanded ? null : pick.id)}
                >
                  <div className="flex items-center gap-3">
                    {/* Rank */}
                    <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      index === 0 ? "bg-[#C59D5F] text-white" :
                      index < 3 ? "bg-[#C59D5F]/20 text-[#C59D5F]" :
                      index < 5 ? "bg-gray-100 text-gray-600" :
                      "bg-gray-50 text-gray-400"
                    }`}>
                      {index + 1}
                    </div>

                    {/* Company info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{pick.name}</span>
                        {pick.ticker && (
                          <span className="text-xs text-gray-400">{pick.ticker}</span>
                        )}
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${NODE_TYPE_COLORS[pick.nodeType] ?? ""}`}>
                          {NODE_TYPE_LABELS[pick.nodeType] ?? pick.nodeType}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${POSITION_COLORS[pick.marketPosition] ?? ""}`}>
                          {pick.marketPosition}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">{pick.nodeName}</div>
                    </div>

                    {/* Key metrics */}
                    <div className="hidden sm:flex items-center gap-4 text-xs text-right">
                      <div>
                        <div className="text-gray-400">市值</div>
                        <div className="font-medium text-gray-900">{formatB(pick.mcapB)}</div>
                      </div>
                      <div>
                        <div className="text-gray-400">增速</div>
                        <div className={`font-medium ${pick.growth > 50 ? "text-green-600" : pick.growth > 20 ? "text-amber-600" : "text-gray-900"}`}>
                          {formatPct(pick.growth)}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-400">FwdPE</div>
                        <div className="font-medium text-gray-900">{pick.fwdPe ? `${pick.fwdPe}x` : "-"}</div>
                      </div>
                      <div>
                        <div className="text-gray-400">评分</div>
                        <div className="font-bold text-[#C59D5F]">{pick.score}</div>
                      </div>
                    </div>

                    {/* Expand arrow */}
                    <div className="shrink-0 text-gray-300">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </div>

                  {/* Mobile metrics */}
                  <div className="flex sm:hidden gap-3 mt-2 text-xs">
                    <span>市值 {formatB(pick.mcapB)}</span>
                    <span className={pick.growth > 50 ? "text-green-600" : ""}>增速 {formatPct(pick.growth)}</span>
                    <span>FwdPE {pick.fwdPe ? `${pick.fwdPe}x` : "-"}</span>
                    <span className="text-[#C59D5F] font-bold">评分 {pick.score}</span>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 py-4 bg-gray-50/50">
                    {/* Financial grid */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
                      {[
                        { label: "市值", value: formatB(pick.mcapB) },
                        { label: "营收", value: formatB(pick.revB) },
                        { label: "增速", value: formatPct(pick.growth) },
                        { label: "毛利率", value: pick.gm ? `${pick.gm}%` : "-" },
                        { label: "净利率", value: pick.nm ? `${pick.nm}%` : "-" },
                        { label: "PE", value: pick.pe ? `${pick.pe}x` : "-" },
                        { label: "Forward PE", value: pick.fwdPe ? `${pick.fwdPe}x` : "-" },
                        { label: "PEG", value: pick.peg ? `${pick.peg}` : "-" },
                        { label: "PS", value: pick.ps ? `${pick.ps}x` : "-" },
                        { label: "FCF收益率", value: pick.fcfYield ? `${pick.fcfYield}%` : "-" },
                        { label: "Beta", value: pick.beta ? `${pick.beta}` : "-" },
                        { label: "份额", value: pick.marketShare || "-" },
                      ].map((m) => (
                        <div key={m.label} className="rounded bg-white border border-gray-100 px-2 py-1.5">
                          <div className="text-[10px] text-gray-400">{m.label}</div>
                          <div className="text-xs font-medium text-gray-900">{m.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Moat */}
                    {pick.moat && (
                      <div className="mb-3 rounded bg-[#C59D5F]/5 border border-[#C59D5F]/20 px-3 py-2">
                        <div className="text-[10px] font-semibold text-[#C59D5F] mb-1">护城河</div>
                        <p className="text-xs text-gray-700 leading-relaxed">{pick.moat}</p>
                      </div>
                    )}

                    {/* Highlights */}
                    {pick.highlights?.length > 0 && (
                      <div className="mb-3">
                        <div className="text-[10px] font-semibold text-green-600 mb-1">投资亮点</div>
                        <div className="space-y-1">
                          {pick.highlights.map((h: string, i: number) => (
                            <div key={i} className="flex gap-2 rounded bg-green-50 px-2.5 py-1.5 text-xs text-gray-700">
                              <span className="shrink-0 text-green-500">{i + 1}.</span>
                              <span>{h}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Risks */}
                    {pick.risks?.length > 0 && (
                      <div className="mb-3">
                        <div className="text-[10px] font-semibold text-red-500 mb-1">风险提示</div>
                        <div className="space-y-1">
                          {pick.risks.map((r: string, i: number) => (
                            <div key={i} className="flex gap-2 rounded bg-red-50 px-2.5 py-1.5 text-xs text-gray-700">
                              <span className="shrink-0 text-red-400">{i + 1}.</span>
                              <span>{r}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Rating */}
                    {pick.analystRating && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400">评级</span>
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${getRatingColor(pick.analystRating)}`}>
                          {pick.analystRating}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {picks && picks.length === 0 && (
        <div className="py-16 text-center text-gray-400">
          该行业暂无足够的金融数据进行排名，请先运行数据同步
        </div>
      )}

      {/* Scoring explanation */}
      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">评分模型说明</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600">
          <div>+ 增速（cap 100%）× 1.5</div>
          <div>+ 毛利率 × 0.8（定价权）</div>
          <div>+ PEG 0.1-0.5: +40 / 0.5-1: +30 / 1-1.5: +15</div>
          <div>+ Forward PE &lt; 0.7× Trailing PE: +25（盈利加速）</div>
          <div>+ 正自由现金流: +15</div>
          <div>+ FCF 收益率 &gt; 3%: +20（现金奶牛）</div>
          <div>+ 有护城河: +10</div>
          <div>+ 上游环节: +8（Chokepoint 密集区）</div>
          <div className="text-red-500">- PE &gt; 80: -15 / &gt; 150: -30</div>
          <div className="text-red-500">- 市值 &gt; $500B: -10 / &gt; $2T: -20</div>
          <div className="text-red-500">- PS &gt; 15x: -10 / &gt; 30x: -25</div>
        </div>
      </div>
    </div>
  );
}
