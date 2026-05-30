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
  LEADER: "bg-green-100 text-green-700",
  CHALLENGER: "bg-blue-100 text-blue-700",
  EMERGING: "bg-yellow-100 text-yellow-700",
  NICHE: "bg-gray-100 text-gray-600",
};

export function CompanyPanel({ company, onClose }: CompanyPanelProps) {
  if (!company) return null;

  return (
    <div className="bg-white">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{company.name}</h2>
          {company.ticker && (
            <span className="text-sm text-gray-600">
              {company.exchange}:{company.ticker}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-400 hover:text-gray-700 hover:bg-gray-100">
          ✕
        </Button>
      </div>

      {/* Market Position Badge */}
      <span
        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
          POSITION_COLORS[company.marketPosition] ?? ""
        }`}
      >
        {POSITION_LABELS[company.marketPosition] ?? company.marketPosition}
      </span>

      {/* Main Business */}
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-gray-500">主营业务</h3>
        <p className="mt-1 text-sm text-gray-900">{company.mainBusiness}</p>
      </div>

      {/* Core Products */}
      {company.coreProducts.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-500">核心产品</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {company.coreProducts.map((product) => (
              <span
                key={product}
                className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
              >
                {product}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Financials */}
      {(company.revenue || company.marketCap) && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-500">财务指标</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {company.marketCap && (
              <MetricCard label="市值" value={company.marketCap} />
            )}
            {company.revenue && (
              <MetricCard label="营收" value={company.revenue} />
            )}
            {company.revenueGrowth && (
              <MetricCard label="营收增速" value={company.revenueGrowth} />
            )}
            {company.grossMargin && (
              <MetricCard label="毛利率" value={company.grossMargin} />
            )}
            {company.netMargin && (
              <MetricCard label="净利率" value={company.netMargin} />
            )}
            {company.roe && <MetricCard label="ROE" value={company.roe} />}
            {company.marketShare && (
              <MetricCard label="市场份额" value={company.marketShare} />
            )}
          </div>
        </div>
      )}

      {/* Competitive */}
      {company.moat && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-500">护城河</h3>
          <p className="mt-1 text-sm text-gray-900">{company.moat}</p>
        </div>
      )}

      {/* Investment Highlights */}
      {company.highlights.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-500">投资亮点</h3>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {company.highlights.map((h, i) => (
              <li key={i} className="text-sm text-gray-700">
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Risks */}
      {company.risks.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-500">风险提示</h3>
          <ul className="mt-1 list-inside list-disc space-y-1">
            {company.risks.map((r, i) => (
              <li key={i} className="text-sm text-red-400">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Analyst Rating */}
      {company.analystRating && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-500">综合评级</h3>
          <span className="mt-1 inline-block rounded bg-[#C59D5F]/10 px-2 py-0.5 text-sm font-medium text-[#C59D5F]">
            {company.analystRating}
          </span>
        </div>
      )}

      {/* Competitors */}
      {company.competitors.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-500">主要竞争对手</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {company.competitors.map((c) => (
              <span
                key={c}
                className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-gray-50 p-2 border border-gray-100">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium text-gray-900">{value}</div>
    </div>
  );
}
