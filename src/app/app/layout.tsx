"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TeamContext, useTeamData } from "@/hooks/use-team";
import { AtlasLogo, AtlasWordmark } from "@/components/atlas-logo";

const navItems = [
  { label: "项目", href: "/app/projects" },
  { label: "团队", href: "/app/team" },
  { label: "设置", href: "/app/settings" },
];

function MobileNav() {
  const pathname = usePathname();
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-[#1F2937] bg-[#111827] md:hidden">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "flex flex-1 flex-col items-center py-2 text-xs",
            pathname.startsWith(item.href)
              ? "text-[#C59D5F] font-medium"
              : "text-[#6B7280]"
          )}
        >
          {item.label}
        </Link>
      ))}
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="flex flex-1 flex-col items-center py-2 text-xs text-[#6B7280]"
      >
        退出
      </button>
    </div>
  );
}

function DesktopSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex h-screen w-56 flex-col border-r border-[#1F2937] bg-[#111827]">
      <div className="p-4">
        <Link href="/app" className="flex items-center gap-2">
          <AtlasLogo size={28} />
          <AtlasWordmark />
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
                ? "bg-[#C59D5F]/10 font-medium text-[#C59D5F]"
                : "text-[#6B7280] hover:bg-[#1F2937] hover:text-white"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-[#1F2937] p-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-[#6B7280] hover:text-white hover:bg-[#1F2937]"
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
        <main className="flex-1 overflow-auto bg-[#111827] pb-16 md:pb-0">
          {children}
        </main>
        <MobileNav />
      </div>
    </TeamContext.Provider>
  );
}
