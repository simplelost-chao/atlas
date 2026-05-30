"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface GenerationProgressProps {
  teamId: string;
  projectId: string;
}

interface LogEntry {
  step: number;
  stepName: string;
  message: string;
  costUSD?: number;
  durationMs?: number;
  detail?: string;
  timestamp: string;
}

const statusLabels: Record<string, string> = {
  PENDING: "等待生成",
  GENERATING: "正在生成...",
  COMPLETED: "生成完成",
  FAILED: "生成失败",
};

export function GenerationProgress({
  teamId,
  projectId,
}: GenerationProgressProps) {
  const { data } = trpc.generation.status.useQuery(
    { teamId, projectId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "GENERATING" ? 2000 : false;
      },
    }
  );

  const [expanded, setExpanded] = useState(false);

  if (!data) return null;

  const logs: LogEntry[] = (data as any).logs ?? [];
  const totalCost = logs.reduce((sum, l) => sum + (l.costUSD ?? 0), 0);
  const isActive = data.status === "GENERATING";
  const isFailed = data.status === "FAILED";

  return (
    <Card className={`bg-white border-gray-200 ${isActive ? "border-yellow-400" : isFailed ? "border-red-400" : ""}`}>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">{expanded ? "▼" : "▶"}</span>
            <span className="text-gray-700">生成状态</span>
          </div>
          <div className="flex items-center gap-2">
            {isActive && (
              <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-yellow-400" />
            )}
            {data.status === "COMPLETED" && (
              <div className="h-2.5 w-2.5 rounded-full bg-[#10B981]" />
            )}
            {isFailed && (
              <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
            )}
            <span className="text-xs font-normal text-gray-500">
              {statusLabels[data.status] ?? data.status}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      {expanded && <CardContent className="space-y-3">
        {/* Stats */}
        {(isActive || data.status === "COMPLETED") && (
          <div className="flex gap-4 text-xs text-gray-500">
            <span>环节: {data.nodeCount}</span>
            <span>公司: {data.companyCount}</span>
            {totalCost > 0 && <span>开销: ${totalCost.toFixed(4)}</span>}
          </div>
        )}

        {/* Log entries */}
        {logs.length > 0 && (
          <div className="max-h-96 overflow-y-auto rounded bg-gray-50 p-2">
            <div className="space-y-1">
              {logs.map((log, i) => {
                const isMultiLine = log.message.includes("\n");
                const isResult = ["骨架结构", "发现公司", "投研分析", "利润链"].includes(log.stepName);
                return (
                  <div key={i} className={`text-xs ${isResult ? "border-l-2 border-[#C59D5F]/40 pl-2 py-1" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-gray-400">
                        {new Date(log.timestamp).toLocaleTimeString("zh-CN")}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1 ${
                          log.step === -1
                            ? "bg-red-900/50 text-red-400"
                            : isResult
                              ? "bg-[#C59D5F]/10 text-[#C59D5F]"
                              : log.message.startsWith("完成")
                                ? "bg-[#10B981]/10 text-[#10B981]"
                                : "bg-blue-900/30 text-blue-400"
                        }`}
                      >
                        {log.stepName}
                      </span>
                      {!isMultiLine && (
                        <span className="flex-1 text-gray-600">{log.message}</span>
                      )}
                      {log.durationMs != null && log.durationMs > 0 && (
                        <span className="shrink-0 text-gray-400">
                          {(log.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                      {log.costUSD != null && log.costUSD > 0 && (
                        <span className="shrink-0 text-gray-400">
                          ${log.costUSD.toFixed(4)}
                        </span>
                      )}
                    </div>
                    {isMultiLine && (
                      <pre className="mt-1 whitespace-pre-wrap text-gray-600 leading-relaxed">
                        {log.message}
                      </pre>
                    )}
                  </div>
                );
              })}
              {isActive && (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="animate-pulse">●</span>
                  <span>处理中...</span>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>}
    </Card>
  );
}
