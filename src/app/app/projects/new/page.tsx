"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useTeam } from "@/hooks/use-team";

export default function NewProjectPage() {
  const router = useRouter();
  const { teamId } = useTeam();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  const createProject = trpc.project.create.useMutation({
    onSuccess: (project) => {
      router.push(`/app/projects/${project.id}`);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!teamId) {
      setError("未找到团队，请刷新页面重试");
      return;
    }

    createProject.mutate({
      teamId,
      name,
      industry,
      description: description || undefined,
    });
  }

  return (
    <div className="mx-auto max-w-lg p-4 md:p-6">
      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900">新建项目</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium text-gray-700">
                项目名称
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：AI产业链分析"
                required
                className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="industry" className="text-sm font-medium text-gray-700">
                行业关键词
              </label>
              <Input
                id="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="例如：AI、半导体、新能源"
                required
                className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium text-gray-700">
                描述（可选）
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C59D5F]"
                placeholder="项目背景和目标..."
              />
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                className="border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={createProject.isPending}
                className="bg-[#C59D5F] text-white hover:bg-[#D4AD6F]"
              >
                {createProject.isPending ? "创建中..." : "创建项目"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
