"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useTeam } from "@/hooks/use-team";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "待生成",
  GENERATING: "生成中...",
  COMPLETED: "已完成",
  FAILED: "生成失败",
};

export default function ProjectsPage() {
  const { teamId, isLoading: teamLoading } = useTeam();

  const { data: projects, isLoading } = trpc.project.list.useQuery(
    { teamId: teamId! },
    { enabled: !!teamId }
  );

  if (teamLoading || isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-gray-400">加载中...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">项目列表</h1>
        <Link href="/app/projects/new">
          <Button>新建项目</Button>
        </Link>
      </div>

      {!projects || projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-16">
          <p className="text-gray-500">还没有项目</p>
          <Link href="/app/projects/new" className="mt-4">
            <Button variant="outline">创建第一个项目</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/app/projects/${project.id}`}>
              <Card className="cursor-pointer transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle>{project.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-500">
                    行业：{project.industry}
                  </p>
                  {project.chain && (
                    <p className="mt-1 text-xs text-gray-400">
                      {STATUS_LABELS[project.chain.status] ?? project.chain.status}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
