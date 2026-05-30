import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, teamProcedure } from "../init";
import { db } from "../../db";

export async function createProject(
  teamId: string,
  data: { name: string; industry: string; description?: string }
) {
  return db.project.create({
    data: {
      teamId,
      name: data.name,
      industry: data.industry,
      description: data.description,
    },
  });
}

export async function listProjects(teamId: string) {
  return db.project.findMany({
    where: { teamId },
    include: {
      chain: { select: { id: true, status: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getProject(projectId: string, teamId: string) {
  return db.project.findFirst({
    where: { id: projectId, teamId },
    include: {
      chain: {
        select: { id: true, status: true, maxDepth: true },
      },
    },
  });
}

export async function updateProject(
  projectId: string,
  teamId: string,
  data: { name?: string; description?: string }
) {
  const project = await db.project.findFirst({
    where: { id: projectId, teamId },
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  return db.project.update({
    where: { id: projectId },
    data,
  });
}

export async function deleteProject(projectId: string, teamId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, teamId },
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  return db.project.delete({ where: { id: projectId } });
}

export const projectRouter = createRouter({
  create: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string().min(1).max(200),
        industry: z.string().min(1).max(100),
        description: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole === "VIEWER") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return createProject(input.teamId, input);
    }),

  list: teamProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ input }) => {
      return listProjects(input.teamId);
    }),

  get: teamProcedure
    .input(z.object({ teamId: z.string(), projectId: z.string() }))
    .query(async ({ input }) => {
      const project = await getProject(input.projectId, input.teamId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return project;
    }),

  update: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        projectId: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole === "VIEWER") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return updateProject(input.projectId, input.teamId, input);
    }),

  delete: teamProcedure
    .input(z.object({ teamId: z.string(), projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole !== "OWNER" && ctx.teamRole !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return deleteProject(input.projectId, input.teamId);
    }),
});
