"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTeam } from "@/hooks/use-team";

const PAGE_SIZE = 30;

function formatNum(v: any, suffix = ""): string {
  if (v == null) return "-";
  const n = Number(v);
  if (isNaN(n)) return "-";
  if (suffix === "%") return `${n.toFixed(1)}%`;
  if (suffix === "x") return `${n.toFixed(1)}x`;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

const EXCHANGE_LABELS: Record<string, string> = {
  NASDAQ: "美股", NYSE: "美股", AMEX: "美股",
  HKEX: "港股",
  SSE: "A股", SZSE: "A股", "上交所": "A股", "深交所": "A股", "上交所科创板": "A股", "深圳证券交易所": "A股", "上海证券交易所": "A股",
  TSE: "日股", "东京证券交易所": "日股",
  KRX: "韩股", KOSPI: "韩股", KOSDAQ: "韩股",
  TWSE: "台股", TPE: "台股",
  XETRA: "德股", FRA: "德股",
  LSE: "英股",
  SIX: "瑞股",
};

const EXCHANGE_COLORS: Record<string, string> = {
  "美股": "bg-blue-50 text-blue-700",
  "港股": "bg-red-50 text-red-700",
  "A股": "bg-red-50 text-red-600",
  "日股": "bg-pink-50 text-pink-700",
  "韩股": "bg-purple-50 text-purple-700",
  "台股": "bg-orange-50 text-orange-700",
  "德股": "bg-yellow-50 text-yellow-700",
  "英股": "bg-teal-50 text-teal-700",
  "瑞股": "bg-cyan-50 text-cyan-700",
};

function getMarketLabel(exchange: string | null): string {
  if (!exchange) return "-";
  return EXCHANGE_LABELS[exchange] ?? exchange;
}

type SortField = "liveMarketCap" | "liveRevenue" | "liveRevenueGrowth" | "liveGrossMargin" | "liveNetMargin" | "livePeRatio" | "liveForwardPE" | "name";
type SortDir = "asc" | "desc";

export default function DataPage() {
  const { teamId } = useTeam();
  const [page, setPage] = useState(0);
  const [filterIndustry, setFilterIndustry] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterMarket, setFilterMarket] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("liveMarketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data } = trpc.status.companyData.useQuery(
    { teamId: teamId!, page, pageSize: PAGE_SIZE, industry: filterIndustry, source: filterSource, market: filterMarket, sortField, sortDir },
    { enabled: !!teamId }
  );

  const companies = data?.companies ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const stats = data?.stats;

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(0);
  };

  const SortHeader = ({ field, label, align = "right" }: { field: SortField; label: string; align?: string }) => (
    <th
      className={`px-3 py-2 ${align === "left" ? "text-left" : "text-right"} cursor-pointer hover:text-gray-900 select-none`}
      onClick={() => toggleSort(field)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {sortField === field && (
          <span className="text-[#C59D5F]">{sortDir === "desc" ? "↓" : "↑"}</span>
        )}
      </span>
    </th>
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">数据总览</h1>
      <p className="text-sm text-gray-500 mb-4">所有上市公司实时金融数据</p>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <div className="text-2xl font-bold text-gray-900">{stats.totalCompanies}</div>
            <div className="text-[11px] text-gray-500">总公司</div>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.withLiveData}</div>
            <div className="text-[11px] text-gray-500">有实时数据</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <div className="text-2xl font-bold text-gray-400">{stats.withoutLiveData}</div>
            <div className="text-[11px] text-gray-500">待同步</div>
          </div>
          <div className="rounded-lg border border-[#C59D5F]/30 bg-[#C59D5F]/5 p-3 text-center">
            <div className="text-2xl font-bold text-[#C59D5F]">{stats.withMoat}</div>
            <div className="text-[11px] text-gray-500">有深度分析</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select value={filterIndustry} onChange={(e) => { setFilterIndustry(e.target.value); setPage(0); }}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700">
          <option value="all">全部产业</option>
          {stats?.industries?.map((ind: string) => (
            <option key={ind} value={ind}>{ind}</option>
          ))}
        </select>
        <select value={filterMarket} onChange={(e) => { setFilterMarket(e.target.value); setPage(0); }}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700">
          <option value="all">全部市场</option>
          <option value="us">美股</option>
          <option value="hk">港股</option>
          <option value="a">A股</option>
          <option value="jp">日股</option>
          <option value="kr">韩股</option>
          <option value="tw">台股</option>
          <option value="eu">欧股</option>
        </select>
        <select value={filterSource} onChange={(e) => { setFilterSource(e.target.value); setPage(0); }}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700">
          <option value="all">全部来源</option>
          <option value="live">有实时数据</option>
          <option value="ai">仅AI估算</option>
        </select>
        <span className="text-xs text-gray-400 self-center ml-2">共 {total} 家</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-[11px] text-gray-500 uppercase">
                <SortHeader field="name" label="公司" align="left" />
                <th className="px-3 py-2 text-left">代码</th>
                <th className="px-3 py-2 text-center">市场</th>
                <th className="px-3 py-2 text-left">产业</th>
                <SortHeader field="liveMarketCap" label="市值" />
                <SortHeader field="liveRevenue" label="营收" />
                <SortHeader field="liveRevenueGrowth" label="增速" />
                <SortHeader field="liveGrossMargin" label="毛利率" />
                <SortHeader field="liveNetMargin" label="净利率" />
                <SortHeader field="livePeRatio" label="PE" />
                <SortHeader field="liveForwardPE" label="FwdPE" />
                <th className="px-3 py-2 text-center">涨跌</th>
                <th className="px-3 py-2 text-center">来源</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c: any) => {
                const hasLive = c.liveMarketCap != null;
                const mkt = getMarketLabel(c.exchange);
                const mktColor = EXCHANGE_COLORS[mkt] ?? "bg-gray-50 text-gray-600";
                return (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{c.name}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{c.ticker ?? "-"}</td>
                    <td className="px-3 py-2 text-center">
                      {mkt !== "-" && (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${mktColor}`}>{mkt}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{c.industry}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">{hasLive ? formatNum(c.liveMarketCap) : (c.marketCap?.slice(0, 12) ?? "-")}</td>
                    <td className="px-3 py-2 text-right text-gray-900">{hasLive ? formatNum(c.liveRevenue) : (c.revenue?.slice(0, 12) ?? "-")}</td>
                    <td className={`px-3 py-2 text-right font-medium ${hasLive && Number(c.liveRevenueGrowth) > 50 ? "text-green-600" : hasLive && Number(c.liveRevenueGrowth) > 0 ? "text-gray-900" : hasLive ? "text-red-500" : "text-gray-500"}`}>
                      {hasLive ? formatNum(c.liveRevenueGrowth, "%") : (c.revenueGrowth?.slice(0, 8) ?? "-")}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">{hasLive ? formatNum(c.liveGrossMargin, "%") : (c.grossMargin?.slice(0, 8) ?? "-")}</td>
                    <td className={`px-3 py-2 text-right ${hasLive && Number(c.liveNetMargin) < 0 ? "text-red-500" : "text-gray-700"}`}>
                      {hasLive ? formatNum(c.liveNetMargin, "%") : (c.netMargin?.slice(0, 8) ?? "-")}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">{hasLive ? formatNum(c.livePeRatio, "x") : "-"}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{hasLive ? formatNum(c.liveForwardPE, "x") : "-"}</td>
                    <td className={`px-3 py-2 text-center font-medium ${c.liveChange != null && Number(c.liveChange) > 0 ? "text-green-600" : c.liveChange != null && Number(c.liveChange) < 0 ? "text-red-500" : "text-gray-400"}`}>
                      {c.liveChange != null ? `${Number(c.liveChange) >= 0 ? "+" : ""}${Number(c.liveChange).toFixed(2)}%` : "-"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${hasLive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {hasLive ? "实时" : "AI"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50">
            <span className="text-xs text-gray-400">
              {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} / {total}
            </span>
            <div className="flex gap-1">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}
                className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-white disabled:opacity-30">上一页</button>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}
                className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-white disabled:opacity-30">下一页</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
