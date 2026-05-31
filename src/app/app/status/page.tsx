"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTeam } from "@/hooks/use-team";

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)}分${sec % 60}秒`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}小时${m}分`;
}

export default function StatusPage() {
  const { teamId } = useTeam();

  const { data, dataUpdatedAt } = trpc.status.overview.useQuery(
    { teamId: teamId! },
    { enabled: !!teamId, refetchInterval: 10000 }
  );

  const [logPage, setLogPage] = useState(0);
  const LOG_PAGE_SIZE = 30;
  const industries = data?.industries ?? [];
  const analysisProgress = data?.analysisProgress ?? [];
  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("zh-CN") : "";

  const statusConfig: Record<string, { text: string; color: string; dot: string }> = {
    COMPLETED: { text: "已完成", color: "bg-green-100 text-green-700", dot: "bg-green-500" },
    GENERATING: { text: "生成中", color: "bg-amber-100 text-amber-700", dot: "bg-amber-500 animate-pulse" },
    FAILED: { text: "失败", color: "bg-red-100 text-red-700", dot: "bg-red-500" },
    PENDING: { text: "等待中", color: "bg-gray-100 text-gray-500", dot: "bg-gray-300" },
    NONE: { text: "未开始", color: "bg-gray-50 text-gray-400", dot: "bg-gray-200" },
  };

  const totalNodes = industries.reduce((s, d) => s + d.nodes, 0);
  const totalCompanies = industries.reduce((s, d) => s + d.companies, 0);
  const totalWithMoat = industries.reduce((s, d) => s + d.companiesWithMoat, 0);
  const generating = industries.filter((d) => d.status === "GENERATING").length;
  const completed = industries.filter((d) => d.status === "COMPLETED").length;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">系统状态</h1>
        {lastUpdate && <span className="text-xs text-gray-400">更新于 {lastUpdate}</span>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-gray-900">{industries.length}</div>
          <div className="text-[11px] text-gray-500">产业</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-gray-900">{totalNodes}</div>
          <div className="text-[11px] text-gray-500">环节</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-gray-900">{totalCompanies}</div>
          <div className="text-[11px] text-gray-500">公司</div>
        </div>
        <div className="rounded-lg border border-[#C59D5F]/30 bg-[#C59D5F]/5 p-3 text-center">
          <div className="text-2xl font-bold text-[#C59D5F]">{totalWithMoat}</div>
          <div className="text-[11px] text-gray-500">已深度分析</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{completed}<span className="text-gray-300 text-lg">/{industries.length}</span></div>
          <div className="text-[11px] text-gray-500">已完成</div>
        </div>
      </div>

      {/* Per industry */}
      <div className="space-y-3">
        {industries.map((item) => {
          const st = statusConfig[item.status] ?? statusConfig.NONE;
          const isActive = item.status === "GENERATING";

          return (
            <div key={item.industry} className={`rounded-lg border bg-white overflow-hidden ${isActive ? "border-amber-200" : "border-gray-200"}`}>
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={`h-2.5 w-2.5 rounded-full ${st.dot}`} />
                  <div>
                    <h3 className="font-semibold text-gray-900">{item.name}</h3>
                    <span className="text-xs text-gray-400">{item.industry}</span>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.color}`}>
                  {st.text}
                </span>
              </div>

              {isActive && (
                <div className="px-4">
                  <div className="h-1 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#C59D5F] transition-all duration-1000"
                      style={{ width: `${Math.min(95, item.companies > 0 ? Math.round((item.companies / Math.max(item.nodes * 7, 1)) * 100) : item.nodes > 0 ? 15 : 5)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="px-4 py-3">
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
                  <div className="rounded bg-gray-50 px-2 py-1.5">
                    <div className="text-sm font-semibold text-gray-900">{item.nodes}</div>
                    <div className="text-[10px] text-gray-400">环节</div>
                  </div>
                  <div className="rounded bg-gray-50 px-2 py-1.5">
                    <div className="text-sm font-semibold text-gray-900">{item.companies}</div>
                    <div className="text-[10px] text-gray-400">公司</div>
                  </div>
                  <div className="rounded bg-gray-50 px-2 py-1.5">
                    <div className="text-sm font-semibold text-green-600">{item.leaders}</div>
                    <div className="text-[10px] text-gray-400">龙头</div>
                  </div>
                  <div className="rounded bg-gray-50 px-2 py-1.5">
                    <div className="text-sm font-semibold text-blue-600">{item.challengers}</div>
                    <div className="text-[10px] text-gray-400">挑战者</div>
                  </div>
                  <div className="rounded bg-[#C59D5F]/5 px-2 py-1.5">
                    <div className="text-sm font-semibold text-[#C59D5F]">{item.companiesWithMoat}</div>
                    <div className="text-[10px] text-gray-400">已分析</div>
                  </div>
                </div>

                {(item.startedAt || isActive) && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    {item.startedAt && <span>开始: {item.startedAt}</span>}
                    {item.elapsedSec != null && <span>已耗时: <span className="font-medium text-gray-700">{formatDuration(item.elapsedSec)}</span></span>}
                    {item.estimatedRemainingSec != null && <span>预计剩余: <span className="font-medium text-amber-600">~{formatDuration(item.estimatedRemainingSec)}</span></span>}
                    {item.durationSec != null && <span>总耗时: <span className="font-medium text-green-600">{formatDuration(item.durationSec)}</span></span>}
                  </div>
                )}

                {isActive && item.lastLog && (
                  <div className="mt-2 rounded bg-gray-50 px-3 py-1.5 text-xs text-gray-500 truncate">
                    {item.lastLog.split("\n")[0]}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Deep Analysis Progress */}
      {analysisProgress.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3">深度分析进度</h2>
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="grid grid-cols-4 gap-0 border-b border-gray-100 px-4 py-2 text-[11px] font-medium text-gray-400 uppercase">
              <span>产业</span>
              <span className="text-center">已分析</span>
              <span className="text-center">待分析</span>
              <span className="text-right">进度</span>
            </div>
            {analysisProgress.map((ap: any) => {
              const total = Number(ap.analyzed) + Number(ap.pending);
              const pct = total > 0 ? Math.round((Number(ap.analyzed) / total) * 100) : 0;
              return (
                <div key={ap.industry} className="grid grid-cols-4 gap-0 border-b border-gray-50 px-4 py-2.5 items-center">
                  <span className="text-sm text-gray-900">{ap.industry}</span>
                  <span className="text-center text-sm font-medium text-[#C59D5F]">{String(ap.analyzed)}</span>
                  <span className="text-center text-sm text-gray-500">{String(ap.pending)}</span>
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-[#C59D5F] transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                  </div>
                </div>
              );
            })}
            <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500">
              总计: {analysisProgress.reduce((s: number, a: any) => s + Number(a.analyzed), 0)} 已分析 / {analysisProgress.reduce((s: number, a: any) => s + Number(a.analyzed) + Number(a.pending), 0)} 龙头+挑战者
            </div>
          </div>
        </div>
      )}

      {/* Analysis Logs with Pagination */}
      {(() => {
        const allLogs = (data?.recentLogs as any[]) ?? [];
        const totalLogs = (data as any)?.logTotalCount ?? allLogs.length;
        const pagedLogs = allLogs.slice(logPage * LOG_PAGE_SIZE, (logPage + 1) * LOG_PAGE_SIZE);
        const totalPages = Math.ceil(allLogs.length / LOG_PAGE_SIZE);

        if (allLogs.length === 0) return null;
        return (
          <div className="mt-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3">分析记录 ({totalLogs})</h2>
            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-[11px] text-gray-400 uppercase">
                      <th className="px-3 py-2 text-left">时间</th>
                      <th className="px-3 py-2 text-left">公司</th>
                      <th className="px-3 py-2 text-left">产业</th>
                      <th className="px-3 py-2 text-left">环节</th>
                      <th className="px-3 py-2 text-center">耗时</th>
                      <th className="px-3 py-2 text-center">费用</th>
                      <th className="px-3 py-2 text-center">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedLogs.map((log: any, i: number) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{log.createdAt}</td>
                        <td className="px-3 py-1.5 font-medium text-gray-900">{log.companyName}</td>
                        <td className="px-3 py-1.5 text-gray-500">{log.industry}</td>
                        <td className="px-3 py-1.5 text-gray-500">{log.nodeName}</td>
                        <td className="px-3 py-1.5 text-center text-gray-700">{log.durationSec}s</td>
                        <td className="px-3 py-1.5 text-center text-gray-500">{log.costUsd ? `$${Number(log.costUsd).toFixed(3)}` : "-"}</td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${log.status === "success" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                            {log.status === "success" ? "成功" : "失败"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50">
                  <span className="text-xs text-gray-400">
                    {logPage * LOG_PAGE_SIZE + 1}-{Math.min((logPage + 1) * LOG_PAGE_SIZE, allLogs.length)} / {totalLogs}
                  </span>
                  <div className="flex gap-1">
                    <button disabled={logPage === 0} onClick={() => setLogPage(logPage - 1)}
                      className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-white disabled:opacity-30">上一页</button>
                    <button disabled={logPage >= totalPages - 1} onClick={() => setLogPage(logPage + 1)}
                      className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-white disabled:opacity-30">下一页</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <p className="mt-4 text-center text-xs text-gray-400">每 10 秒自动刷新</p>
    </div>
  );
}
