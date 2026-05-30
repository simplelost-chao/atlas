"use client";

import { use, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerationProgress } from "@/components/generation-progress";

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  // TODO: get teamId from team context/session — hardcoded placeholder
  const teamId = ""; // Will be wired when team context is available
  const [generating, setGenerating] = useState(false);

  const startGeneration = trpc.generation.start.useMutation({
    onSuccess: () => {
      setGenerating(false);
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
    startGeneration.mutate({
      teamId,
      projectId,
      maxDepth: 3,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">项目详情</h1>
        <Button onClick={handleGenerate} disabled={generating || !teamId}>
          {generating ? "正在启动..." : "生成产业链"}
        </Button>
      </div>

      {teamId && (
        <GenerationProgress teamId={teamId} projectId={projectId} />
      )}

      {/* Tree visualization will go here in Phase 3 */}
      <Card>
        <CardHeader>
          <CardTitle>产业链可视化</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-96 items-center justify-center rounded-lg border border-dashed border-gray-300">
            <p className="text-gray-400">
              树状图可视化将在 Phase 3 中实现
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
