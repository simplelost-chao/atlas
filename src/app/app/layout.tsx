"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TeamContext, useTeamData } from "@/hooks/use-team";

const navItems = [
  { label: "项目", href: "/app/projects" },
  { label: "团队", href: "/app/team" },
  { label: "设置", href: "/app/settings" },
];

function MobileNav() {
  const pathname = usePathname();
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-gray-200 bg-white md:hidden">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex flex-1 flex-col items-center py-2 text-xs",
            pathname.startsWith(item.href)
              ? "text-gray-900 font-medium"
              : "text-gray-500"
          )}
        >
          {item.label}
        </Link>
      ))}
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="flex flex-1 flex-col items-center py-2 text-xs text-gray-500"
      >
        退出
      </button>
    </div>
  );
}

function DesktopSidebar() {
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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const teamData = useTeamData();
  return (
    <TeamContext.Provider value={teamData}>
      <div className="flex h-screen">
        <DesktopSidebar />
        <main className="flex-1 overflow-auto bg-white pb-16 md:pb-0">
          {children}
        </main>
        <MobileNav />
      </div>
    </TeamContext.Provider>
  );
}
