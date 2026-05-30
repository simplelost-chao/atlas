"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ProjectsPage() {
  // TODO: Replace with trpc.project.list.useQuery() once team context is wired
  const projects: Array<{
    id: string;
    name: string;
    industry: string;
    updatedAt: string;
    chain?: { status: string };
  }> = [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">项目列表</h1>
        <Link href="/app/projects/new">
          <Button>新建项目</Button>
        </Link>
      </div>

      {projects.length === 0 ? (
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
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
