"use client";

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface GenerationProgressProps {
  teamId: string;
  projectId: string;
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

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">生成状态</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {data.status === "GENERATING" && (
              <div className="h-3 w-3 animate-pulse rounded-full bg-yellow-400" />
            )}
            {data.status === "COMPLETED" && (
              <div className="h-3 w-3 rounded-full bg-green-500" />
            )}
            {data.status === "FAILED" && (
              <div className="h-3 w-3 rounded-full bg-red-500" />
            )}
            {data.status === "PENDING" && (
              <div className="h-3 w-3 rounded-full bg-gray-300" />
            )}
            <span className="text-sm">{statusLabels[data.status] ?? data.status}</span>
          </div>
          {(data.status === "GENERATING" || data.status === "COMPLETED") && (
            <div className="text-xs text-gray-500">
              环节: {data.nodeCount} 个 | 公司: {data.companyCount} 家
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
