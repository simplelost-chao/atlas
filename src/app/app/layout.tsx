"use client";

import { Sidebar } from "@/components/sidebar";
import { TeamContext, useTeamData } from "@/hooks/use-team";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const teamData = useTeamData();

  return (
    <TeamContext.Provider value={teamData}>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto bg-white">{children}</main>
      </div>
    </TeamContext.Provider>
  );
}
