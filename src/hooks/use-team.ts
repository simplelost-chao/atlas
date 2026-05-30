"use client";

import { createContext, useContext } from "react";
import { trpc } from "@/lib/trpc";

interface TeamContextValue {
  teamId: string | null;
  teamName: string | null;
  role: string | null;
  isLoading: boolean;
}

export const TeamContext = createContext<TeamContextValue>({
  teamId: null,
  teamName: null,
  role: null,
  isLoading: true,
});

export function useTeam() {
  return useContext(TeamContext);
}

/**
 * Hook that fetches the user's first team.
 * In the future this can be extended with team switching.
 */
export function useTeamData(): TeamContextValue {
  const { data, isLoading } = trpc.team.list.useQuery(undefined, {
    staleTime: 60_000,
  });

  const firstTeam = data?.[0];

  return {
    teamId: firstTeam?.id ?? null,
    teamName: firstTeam?.name ?? null,
    role: firstTeam?.role ?? null,
    isLoading,
  };
}
