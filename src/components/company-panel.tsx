"use client";

import type { Company } from "@prisma/client";
import { Button } from "@/components/ui/button";

interface CompanyPanelProps {
  company: Company | null;
  onClose: () => void;
}

const POSITION_LABELS: Record<string, string> = {
  LEADER: "行业龙头",
  CHALLENGER: "挑战者",
  EMERGING: "新兴力量",
  NICHE: "细分领域",
};

const POSITION_COLORS: Record<string, string> = {
  LEADER: "bg-green-600 text-white",
  CHALLENGER: "bg-blue-600 text-white",
  EMERGING: "bg-amber-500 text-white",
  NICHE: "bg-gray-500 text-white",
};

/**
 * Serenity Chokepoint Scoring:
 * - 护城河 (moat): 技术壁垒多高？竞争者要多久追上？
 * - 不可替代性: 如果断供谁最受影响？有替代供应商吗？
 * - 市场地位: LEADER=垄断/寡头，NICHE=细分垄断
 * - 客户质量: 客户是行业巨头吗？
 */
function computeChokepoint(company: Company) {
  const dims: Array<{ label: string; score: number; max: number; reason: string }> = [];

  // 1. 护城河
  let moatScore = 0;
  let moatReason = "无数据";
  if (company.moat) {
    moatScore = company.moat.length > 50 ? 5 : company.moat.length > 20 ? 3 : 2;
    moatReason = company.moat;
  }
  dims.push({ label: "护城河", score: moatScore, max: 5, reason: moatReason });

  // 2. 市场地位
  let posScore = 0;
  let posReason = "未知";
  if (company.marketPosition === "LEADER") { posScore = 5; posReason = "行业龙头，具备定价权"; }
  else if (company.marketPosition === "NICHE") { posScore = 4; posReason = "细分领域垄断，不可替代性强"; }
  else if (company.marketPosition === "CHALLENGER") { posScore = 3; posReason = "行业挑战者，有追赶潜力"; }
  else if (company.marketPosition === "EMERGING") { posScore = 2; posReason = "新兴力量，高风险高回报"; }
  dims.push({ label: "市场地位", score: posScore, max: 5, reason: posReason });

  // 3. 市场份额
  let shareScore = 0;
  let shareReason = "无数据";
  if (company.marketShare) {
    const pct = parseInt(company.marketShare);
    if (pct >= 50) { shareScore = 5; shareReason = `${company.marketShare} — 垄断级份额`; }
    else if (pct >= 30) { shareScore = 4; shareReason = `${company.marketShare} — 强势领先`; }
    else if (pct >= 15) { shareScore = 3; shareReason = `${company.marketShare} — 主要玩家`; }
    else { shareScore = 2; shareReason = `${company.marketShare}`; }
    if (isNaN(pct)) { shareScore = 3; shareReason = company.marketShare; }
  }
  dims.push({ label: "市场份额", score: shareScore, max: 5, reason: shareReason });

  // 4. 成长性
  let growthScore = 0;
  let growthReason = "无数据";
  if (company.revenueGrowth) {
    const g = parseInt(company.revenueGrowth);
    if (g >= 50) { growthScore = 5; growthReason = `${company.revenueGrowth} — 爆发式增长`; }
    else if (g >= 25) { growthScore = 4; growthReason = `${company.revenueGrowth} — 高速增长`; }
    else if (g >= 10) { growthScore = 3; growthReason = `${company.revenueGrowth} — 稳健增长`; }
    else if (g > 0) { growthScore = 2; growthReason = `${company.revenueGrowth} — 温和增长`; }
    else { growthScore = 1; growthReason = `${company.revenueGrowth} — 增速放缓`; }
    if (isNaN(g)) { growthScore = 3; growthReason = company.revenueGrowth; }
  }
  dims.push({ label: "成长性", score: growthScore, max: 5, reason: growthReason });

  // 5. 盈利能力
  let profitScore = 0;
  let profitReason = "无数据";
  if (company.grossMargin) {
    const gm = parseInt(company.grossMargin);
    if (gm >= 60) { profitScore = 5; profitReason = `毛利率 ${company.grossMargin} — 极强定价权`; }
    else if (gm >= 40) { profitScore = 4; profitReason = `毛利率 ${company.grossMargin} — 强定价权`; }
    else if (gm >= 25) { profitScore = 3; profitReason = `毛利率 ${company.grossMargin} — 中等`; }
    else { profitScore = 2; profitReason = `毛利率 ${company.grossMargin} — 偏低`; }
    if (isNaN(gm)) { profitScore = 3; profitReason = `毛利率 ${company.grossMargin}`; }
  }
  dims.push({ label: "盈利能力", score: profitScore, max: 5, reason: profitReason });

  const totalScore = dims.reduce((s, d) => s + d.score, 0);
  const maxTotal = dims.reduce((s, d) => s + d.max, 0);

  return { dims, totalScore, maxTotal };
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`h-2 w-4 rounded-sm ${
            i < score
              ? score >= 4 ? "bg-[#C59D5F]" : score >= 3 ? "bg-amber-400" : "bg-gray-300"
              : "bg-gray-100"
          }`}
        />
      ))}
    </div>
  );
}

function RiskBar({ count, total }: { count: number; total: number }) {
  const level = count >= 4 ? "高" : count >= 2 ? "中" : "低";
  const color = count >= 4 ? "text-red-600 bg-red-50" : count >= 2 ? "text-amber-600 bg-amber-50" : "text-green-600 bg-green-50";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>
      风险{level} ({count}项)
    </span>
  );
}

export function CompanyPanel({ company, onClose }: CompanyPanelProps) {
  if (!company) return null;

  const { dims, totalScore, maxTotal } = computeChokepoint(company);
  const overallPct = Math.round((totalScore / maxTotal) * 100);
  const overallLabel = overallPct >= 70 ? "强烈关注" : overallPct >= 50 ? "值得关注" : overallPct >= 30 ? "一般" : "数据不足";
  const overallColor = overallPct >= 70 ? "text-[#C59D5F]" : overallPct >= 50 ? "text-amber-600" : "text-gray-500";

  return (
    <div className="bg-white">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">{company.name}</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${POSITION_COLORS[company.marketPosition] ?? ""}`}>
              {POSITION_LABELS[company.marketPosition] ?? company.marketPosition}
            </span>
          </div>
          {company.ticker && (
            <span className="text-sm text-gray-500">{company.exchange}:{company.ticker}</span>
          )}
          <p className="mt-1 text-sm text-gray-600">{company.mainBusiness}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</Button>
      </div>

      {/* ═══ Chokepoint 综合评估 ═══ */}
      <div className="mt-5 rounded-lg border border-[#C59D5F]/30 bg-[#C59D5F]/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Chokepoint 评估</h3>
          <div className="flex items-center gap-2">
            <span className={`text-lg font-bold ${overallColor}`}>{overallPct}分</span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${overallColor} ${overallPct >= 70 ? "bg-[#C59D5F]/10" : overallPct >= 50 ? "bg-amber-50" : "bg-gray-100"}`}>
              {overallLabel}
            </span>
          </div>
        </div>
        <div className="space-y-2.5">
          {dims.map((dim) => (
            <div key={dim.label}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-medium text-gray-700">{dim.label}</span>
                <ScoreBar score={dim.score} max={dim.max} />
              </div>
              <p className="text-xs text-gray-500 line-clamp-2">{dim.reason}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ 财务指标 ═══ */}
      <div className="mt-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">财务指标</h3>
        <div className="grid grid-cols-3 gap-2">
          <MetricCard label="市值" value={company.marketCap} />
          <MetricCard label="营收" value={company.revenue} />
          <MetricCard label="营收增速" value={company.revenueGrowth} />
          <MetricCard label="毛利率" value={company.grossMargin} />
          <MetricCard label="净利率" value={company.netMargin} />
          <MetricCard label="ROE" value={company.roe} />
        </div>
        {company.marketShare && (
          <div className="mt-2 rounded bg-gray-50 border border-gray-100 px-3 py-2 text-sm">
            <span className="text-gray-500">市场份额: </span>
            <span className="font-medium text-gray-900">{company.marketShare}</span>
          </div>
        )}
      </div>

      {/* ═══ 核心产品 ═══ */}
      {company.coreProducts.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">核心产品</h3>
          <div className="flex flex-wrap gap-1.5">
            {company.coreProducts.map((p) => (
              <span key={p} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">{p}</span>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 投资亮点 (为什么推荐) ═══ */}
      {company.highlights.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">为什么值得关注</h3>
          <div className="space-y-1.5">
            {company.highlights.map((h, i) => (
              <div key={i} className="flex gap-2 rounded bg-green-50 border border-green-100 px-3 py-2">
                <span className="shrink-0 text-green-500 mt-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                <span className="text-sm text-gray-700">{h}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 风险提示 (可视化) ═══ */}
      {company.risks.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900">风险提示</h3>
            <RiskBar count={company.risks.length} total={5} />
          </div>
          <div className="space-y-1.5">
            {company.risks.map((r, i) => (
              <div key={i} className="flex gap-2 rounded bg-red-50 border border-red-100 px-3 py-2">
                <span className="shrink-0 text-red-400 mt-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                </span>
                <span className="text-sm text-gray-700">{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 护城河详解 ═══ */}
      {company.moat && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">护城河分析</h3>
          <div className="rounded bg-[#C59D5F]/5 border border-[#C59D5F]/20 px-3 py-2.5">
            <p className="text-sm text-gray-700 leading-relaxed">{company.moat}</p>
          </div>
        </div>
      )}

      {/* ═══ 客户集中度 ═══ */}
      {company.customerConcentration && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">客户集中度</h3>
          <p className="text-sm text-gray-700">{company.customerConcentration}</p>
        </div>
      )}

      {/* ═══ 竞争格局 ═══ */}
      {company.competitors.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">主要竞争对手</h3>
          <div className="flex flex-wrap gap-1.5">
            {company.competitors.map((c) => (
              <span key={c} className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600">{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 综合评级 ═══ */}
      {company.analystRating && (
        <div className="mt-5 flex items-center gap-3 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
          <span className="text-sm text-gray-500">综合评级</span>
          <span className="rounded bg-[#C59D5F]/10 px-3 py-1 text-sm font-semibold text-[#C59D5F]">
            {company.analystRating}
          </span>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded bg-gray-50 border border-gray-100 px-3 py-2">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="text-sm font-medium text-gray-900 truncate">{value || "—"}</div>
    </div>
  );
}
