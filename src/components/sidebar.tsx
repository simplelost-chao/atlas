"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "项目", href: "/app/projects" },
  { label: "团队", href: "/app/team" },
  { label: "设置", href: "/app/settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex h-screen w-56 flex-col border-r border-gray-200 bg-gray-50">
      <div className="p-4">
        <Link href="/app" className="text-xl font-bold">
          Atlas
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "block rounded-md px-3 py-2 text-sm transition-colors",
              pathname.startsWith(item.href)
                ? "bg-gray-200 font-medium text-gray-900"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-gray-200 p-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-gray-600"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          退出登录
        </Button>
      </div>
    </aside>
  );
}
