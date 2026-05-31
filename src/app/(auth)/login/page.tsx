"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const callbackUrl = searchParams.get("callbackUrl") ?? "/app";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    await signIn("credentials", {
      login,
      password,
      callbackUrl,
    });
  }

  return (
    <Card className="bg-[#1F2937] border-[#374151]">
      <CardHeader>
        <CardTitle className="text-center text-white">登录</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-red-400 text-center">{error}</p>
          )}
          <div className="space-y-2">
            <label htmlFor="login" className="text-sm font-medium text-[#9CA3AF]">
              用户名或邮箱
            </label>
            <Input
              id="login"
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="admin 或 admin@atlas.dev"
              required
              className="bg-[#111827] border-[#374151] text-white placeholder:text-[#4B5563]"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-[#9CA3AF]">
              密码
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="bg-[#111827] border-[#374151] text-white placeholder:text-[#4B5563]"
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-[#C59D5F] text-white hover:bg-[#D4AD6F]"
            disabled={loading}
          >
            {loading ? "登录中..." : "登录"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-[#6B7280]">
          没有账号？{" "}
          <Link href="/register" className="text-[#C59D5F] hover:underline">
            注册
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
