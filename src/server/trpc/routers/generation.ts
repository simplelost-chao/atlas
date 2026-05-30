import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, teamProcedure } from "../init";
import { runFullPipeline, type PipelineContext } from "../../ai/pipeline";
import { createRouterFromTeamKeys } from "../../ai/llm-router";

export const generationRouter = createRouter({
  /**
   * Start generating an industry chain for a project.
   * Creates the IndustryChain record and kicks off the pipeline
   * as a background task (fire-and-forget from the API perspective).
   */
  start: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        projectId: z.string(),
        maxDepth: z.number().min(2).max(5).default(3),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole === "VIEWER") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Verify project belongs to team
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, teamId: input.teamId },
        include: { chain: true },
      });

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      // Prevent re-generation if already generating
      if (project.chain?.status === "GENERATING") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Generation is already in progress",
        });
      }

      // Delete existing chain if regenerating
      if (project.chain) {
        await ctx.db.industryChain.delete({
          where: { id: project.chain.id },
        });
      }

      // Create new chain
      const chain = await ctx.db.industryChain.create({
        data: {
          projectId: input.projectId,
          status: "GENERATING",
          maxDepth: input.maxDepth,
        },
      });

      // Create LLM router from team API keys
      let router;
      try {
        router = await createRouterFromTeamKeys(input.teamId, ctx.db);
      } catch {
        await ctx.db.industryChain.update({
          where: { id: chain.id },
          data: { status: "FAILED" },
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No LLM API keys configured. Go to Settings to add your API keys.",
        });
      }

      // Fire-and-forget: run pipeline in background
      const pipelineCtx: PipelineContext = {
        db: ctx.db,
        router,
        chainId: chain.id,
        industry: project.industry,
        maxDepth: input.maxDepth,
      };

      // Don't await — let it run in the background
      runFullPipeline(pipelineCtx).catch((err) => {
        console.error("Pipeline failed:", err);
      });

      return { chainId: chain.id, status: "GENERATING" };
    }),

  /**
   * Get the current generation status and progress.
   */
  status: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        projectId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, teamId: input.teamId },
        include: {
          chain: {
            select: {
              id: true,
              status: true,
              maxDepth: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (!project.chain) {
        return { status: "PENDING" as const, nodeCount: 0, companyCount: 0 };
      }

      const [nodeCount, companyCount] = await Promise.all([
        ctx.db.chainNode.count({ where: { chainId: project.chain.id } }),
        ctx.db.company.count({
          where: { chainNode: { chainId: project.chain.id } },
        }),
      ]);

      return {
        chainId: project.chain.id,
        status: project.chain.status,
        maxDepth: project.chain.maxDepth,
        nodeCount,
        companyCount,
        updatedAt: project.chain.updatedAt,
      };
    }),

  /**
   * Get the full generated chain data (nodes + companies).
   */
  results: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        projectId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, teamId: input.teamId },
        include: {
          chain: {
            include: {
              nodes: {
                include: {
                  companies: true,
                },
                orderBy: [{ level: "asc" }, { order: "asc" }],
              },
            },
          },
        },
      });

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return {
        chain: project.chain,
        project: {
          id: project.id,
          name: project.name,
          industry: project.industry,
        },
      };
    }),
});
