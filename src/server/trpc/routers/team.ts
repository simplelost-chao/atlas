import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedProcedure, teamProcedure } from "../init";
import { db } from "../../db";
import type { TeamRole } from "@prisma/client";

export async function createTeam(userId: string, name: string) {
  return db.team.create({
    data: {
      name,
      members: {
        create: {
          userId,
          role: "OWNER",
        },
      },
    },
  });
}

export async function listUserTeams(userId: string) {
  const memberships = await db.teamMember.findMany({
    where: { userId },
    include: {
      team: {
        include: {
          _count: { select: { members: true, projects: true } },
        },
      },
    },
  });

  return memberships.map((m) => ({
    ...m.team,
    role: m.role,
    memberCount: m.team._count.members,
    projectCount: m.team._count.projects,
  }));
}

export async function updateTeam(
  teamId: string,
  data: { name?: string }
) {
  return db.team.update({
    where: { id: teamId },
    data,
  });
}

export async function getTeamMembers(teamId: string) {
  return db.teamMember.findMany({
    where: { teamId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });
}

export async function updateMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole
) {
  return db.teamMember.update({
    where: { teamId_userId: { teamId, userId } },
    data: { role },
  });
}

export async function removeMember(teamId: string, userId: string) {
  return db.teamMember.delete({
    where: { teamId_userId: { teamId, userId } },
  });
}

export const teamRouter = createRouter({
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return createTeam(ctx.userId, input.name);
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return listUserTeams(ctx.userId);
  }),

  update: teamProcedure
    .input(z.object({ teamId: z.string(), name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole !== "OWNER" && ctx.teamRole !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return updateTeam(input.teamId, { name: input.name });
    }),

  members: teamProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ input }) => {
      return getTeamMembers(input.teamId);
    }),

  updateMemberRole: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
        role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole !== "OWNER") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return updateMemberRole(input.teamId, input.userId, input.role);
    }),

  removeMember: teamProcedure
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole !== "OWNER" && ctx.teamRole !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return removeMember(input.teamId, input.userId);
    }),

  invite: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        email: z.string().email(),
        role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole !== "OWNER" && ctx.teamRole !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { createInvite } = await import("../../services/invite");
      return createInvite(input.teamId, input.email, input.role);
    }),

  pendingInvites: teamProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ input }) => {
      const { listPendingInvites } = await import("../../services/invite");
      return listPendingInvites(input.teamId);
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptInvite } = await import("../../services/invite");
      return acceptInvite(input.token, ctx.userId);
    }),
});
