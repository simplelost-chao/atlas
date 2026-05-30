"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/trpc/auth.register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: { name, email, password },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error?.message ?? "注册失败");
      }

      // Auto-login after registration
      await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="bg-[#1F2937] border-[#374151]">
      <CardHeader>
        <CardTitle className="text-center text-white">注册</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium text-[#9CA3AF]">
              名称
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="bg-[#111827] border-[#374151] text-white placeholder:text-[#4B5563]"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-[#9CA3AF]">
              邮箱
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-[#111827] border-[#374151] text-white placeholder:text-[#4B5563]"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-[#9CA3AF]">
              密码（至少8位）
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              className="bg-[#111827] border-[#374151] text-white placeholder:text-[#4B5563]"
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-[#C59D5F] text-white hover:bg-[#D4AD6F]"
            disabled={loading}
          >
            {loading ? "注册中..." : "注册"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-[#6B7280]">
          已有账号？{" "}
          <Link href="/login" className="text-[#C59D5F] hover:underline">
            登录
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
