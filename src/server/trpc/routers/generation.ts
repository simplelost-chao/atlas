import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, teamProcedure } from "../init";
import {
  runFullPipeline,
  runNodeExpansionStep,
  runCompanyDiscoveryStep,
  runDeepAnalysisStep,
  type PipelineContext,
} from "../../ai/pipeline";
import { createRouterFromTeamKeys, LLMRouter } from "../../ai/llm-router";

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
        maxDepth: z.number().min(1).max(5).default(2),
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

      // Try to create LLM router from API keys or env vars.
      // If no keys available, fall back to Claude CLI mode.
      let router: LLMRouter;
      let useCLI = false;
      try {
        router = await createRouterFromTeamKeys(input.teamId, ctx.db);
      } catch {
        // No API keys — use Claude CLI as fallback
        useCLI = true;
        router = new LLMRouter({
          defaultProvider: "anthropic",
          providers: { anthropic: { apiKey: "cli-mode", model: "cli" } },
        });
        console.log("No API keys found, using Claude CLI mode");
      }

      // Fire-and-forget: run pipeline in background
      const pipelineCtx: PipelineContext = {
        db: ctx.db,
        router,
        chainId: chain.id,
        industry: project.industry,
        maxDepth: input.maxDepth,
        useCLI,
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
              logs: true,
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
        logs: project.chain.logs as any[],
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

  /**
   * Backfill: find all nodes missing companies and discover them.
   * Also runs deep analysis on newly found leaders.
   */
  backfill: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        projectId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole === "VIEWER") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const project = await ctx.db.project.findFirst({
        where: { id: input.projectId, teamId: input.teamId },
        include: { chain: true },
      });

      if (!project?.chain) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No chain found" });
      }

      // Find nodes with 0 companies
      const allNodes = await ctx.db.chainNode.findMany({
        where: { chainId: project.chain.id },
        include: { _count: { select: { companies: true } } },
      });
      const emptyNodes = allNodes.filter((n) => n._count.companies === 0);

      if (emptyNodes.length === 0) {
        return { status: "nothing_to_do", message: "所有环节都已有公司数据" };
      }

      // Build pipeline context
      let router: LLMRouter;
      let useCLI = false;
      try {
        router = await createRouterFromTeamKeys(input.teamId, ctx.db);
      } catch {
        useCLI = true;
        router = new LLMRouter({
          defaultProvider: "anthropic",
          providers: { anthropic: { apiKey: "cli-mode", model: "cli" } },
        });
      }

      const pipelineCtx: PipelineContext = {
        db: ctx.db,
        router,
        chainId: project.chain.id,
        industry: project.industry,
        maxDepth: 999,
        useCLI,
      };

      console.log(`[Backfill] Starting for ${emptyNodes.length} nodes without companies`);

      // Fire-and-forget
      (async () => {
        let totalCompanies = 0;
        for (const node of emptyNodes) {
          try {
            const companies = await runCompanyDiscoveryStep(pipelineCtx, node);
            totalCompanies += companies.length;
          } catch (err) {
            console.error(`[Backfill] Failed for ${node.name}:`, err);
          }
        }

        // Deep analysis for leaders found during backfill
        const leaders = await ctx.db.company.findMany({
          where: {
            chainNodeId: { in: emptyNodes.map((n) => n.id) },
            marketPosition: { in: ["LEADER", "CHALLENGER"] },
          },
          include: { chainNode: { select: { name: true } } },
        });

        for (const company of leaders.slice(0, 10)) {
          try {
            await runDeepAnalysisStep(pipelineCtx, company, company.chainNode.name);
          } catch (err) {
            console.error(`[Backfill] Deep analysis failed for ${company.name}:`, err);
          }
        }

        console.log(`[Backfill] Done. ${totalCompanies} companies added for ${emptyNodes.length} nodes.`);
      })();

      return {
        status: "backfilling",
        nodesWithoutCompanies: emptyNodes.length,
        message: `正在为 ${emptyNodes.length} 个环节补全公司数据...`,
      };
    }),

  /**
   * Expand a single node: create sub-nodes + discover companies for each.
   * Used for on-demand drill-down from the UI.
   */
  expandNode: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        nodeId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole === "VIEWER") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Get the node and its chain
      const node = await ctx.db.chainNode.findUnique({
        where: { id: input.nodeId },
        include: {
          chain: { include: { project: true } },
          children: { select: { id: true } },
        },
      });

      if (!node) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
      }

      // Verify team access
      if (node.chain.project.teamId !== input.teamId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Already has children? Skip expansion
      if (node.children.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "该环节已经展开过了",
        });
      }

      // Build pipeline context
      let router: LLMRouter;
      let useCLI = false;
      try {
        router = await createRouterFromTeamKeys(input.teamId, ctx.db);
      } catch {
        useCLI = true;
        router = new LLMRouter({
          defaultProvider: "anthropic",
          providers: { anthropic: { apiKey: "cli-mode", model: "cli" } },
        });
      }

      const pipelineCtx: PipelineContext = {
        db: ctx.db,
        router,
        chainId: node.chainId,
        industry: node.chain.project.industry,
        maxDepth: 999, // no limit for manual expansion
        useCLI,
      };

      // Fire-and-forget: expand + discover companies in background
      (async () => {
        try {
          // Step 1: Expand the node into sub-nodes
          const children = await runNodeExpansionStep(pipelineCtx, node);

          // Step 2: Discover companies for each child node
          for (const child of children) {
            try {
              await runCompanyDiscoveryStep(pipelineCtx, child);
            } catch (err) {
              console.error(`Company discovery failed for ${child.name}:`, err);
            }
          }

          // Step 3: Deep analysis for leaders in the new children
          const allNewCompanies = await ctx.db.company.findMany({
            where: {
              chainNodeId: { in: children.map((c) => c.id) },
              marketPosition: { in: ["LEADER", "CHALLENGER"] },
            },
          });

          for (const company of allNewCompanies.slice(0, 5)) {
            const childNode = children.find((c) => c.id === company.chainNodeId);
            if (childNode) {
              try {
                await runDeepAnalysisStep(pipelineCtx, company, childNode.name);
              } catch (err) {
                console.error(`Deep analysis failed for ${company.name}:`, err);
              }
            }
          }
        } catch (err) {
          console.error(`Node expansion failed for ${node.name}:`, err);
        }
      })();

      return { status: "expanding", nodeId: input.nodeId };
    }),
});
