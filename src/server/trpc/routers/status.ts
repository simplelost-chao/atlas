import { z } from "zod";
import { createRouter, protectedProcedure } from "../init";

export const statusRouter = createRouter({
  overview: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ ctx }) => {
      // Get all timing data from DB directly to avoid timezone issues
      const timings = await ctx.db.$queryRaw<Array<{
        projectId: string;
        status: string;
        elapsed_sec: number;
        duration_sec: number;
        started: string;
      }>>`
        SELECT
          ic."projectId" as "projectId",
          ic.status::text as status,
          EXTRACT(EPOCH FROM (NOW() - ic."createdAt"))::int as elapsed_sec,
          EXTRACT(EPOCH FROM (ic."updatedAt" - ic."createdAt"))::int as duration_sec,
          to_char(ic."createdAt" AT TIME ZONE 'Asia/Shanghai', 'HH24:MI:SS') as started
        FROM "IndustryChain" ic
      `;

      const timingMap = new Map(timings.map(t => [t.projectId, t]));

      const projects = await ctx.db.project.findMany({
        include: {
          chain: {
            select: { id: true, status: true, logs: true },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const results = await Promise.all(
        projects.map(async (project) => {
          const chainId = project.chain?.id;
          if (!chainId) {
            return {
              name: project.name,
              industry: project.industry,
              status: "NONE",
              nodes: 0,
              companies: 0,
              companiesWithMoat: 0,
              leaders: 0,
              challengers: 0,
              startedAt: null as string | null,
              elapsedSec: null as number | null,
              durationSec: null as number | null,
              estimatedRemainingSec: null as number | null,
              lastLog: null as string | null,
            };
          }

          const [nodes, companies, companiesWithMoat, leaders, challengers] =
            await Promise.all([
              ctx.db.chainNode.count({ where: { chainId } }),
              ctx.db.company.count({ where: { chainNode: { chainId } } }),
              ctx.db.company.count({ where: { chainNode: { chainId }, moat: { not: null } } }),
              ctx.db.company.count({ where: { chainNode: { chainId }, marketPosition: "LEADER" } }),
              ctx.db.company.count({ where: { chainNode: { chainId }, marketPosition: "CHALLENGER" } }),
            ]);

          const timing = timingMap.get(project.id);
          const elapsedSec = timing?.elapsed_sec ?? 0;
          const durationSec = timing?.duration_sec ?? 0;

          // Estimate remaining time
          let estimatedRemainingSec: number | null = null;
          if (project.chain!.status === "GENERATING" && nodes > 0) {
            const expectedCompanies = nodes * 7;
            if (companies === 0) {
              estimatedRemainingSec = nodes * 30 + 300 + 30;
            } else if (companies < expectedCompanies * 0.9) {
              const progress = companies / expectedCompanies;
              const timePerCompany = elapsedSec / Math.max(companies, 1);
              estimatedRemainingSec = Math.round((expectedCompanies - companies) * timePerCompany) + 330;
            } else {
              estimatedRemainingSec = 330;
            }
          }

          const logs = project.chain!.logs as any[];
          const lastLog = logs?.length > 0
            ? (logs[logs.length - 1] as any)?.message ?? null
            : null;

          return {
            name: project.name,
            industry: project.industry,
            status: project.chain!.status,
            nodes,
            companies,
            companiesWithMoat,
            leaders,
            challengers,
            startedAt: timing?.started ?? null,
            elapsedSec: project.chain!.status === "GENERATING" ? elapsedSec : null,
            durationSec: project.chain!.status === "COMPLETED" ? Math.max(0, durationSec) : null,
            estimatedRemainingSec,
            lastLog,
          };
        })
      );

      // Deep analysis progress per industry
      const analysisProgress = await ctx.db.$queryRaw<Array<{
        industry: string;
        analyzed: number;
        pending: number;
        total_leaders: number;
      }>>`
        SELECT p.industry,
          COUNT(*) FILTER (WHERE c.moat IS NOT NULL) as analyzed,
          COUNT(*) FILTER (WHERE c.moat IS NULL AND c."marketPosition" IN ('LEADER','CHALLENGER')) as pending,
          COUNT(*) FILTER (WHERE c."marketPosition" IN ('LEADER','CHALLENGER')) as total_leaders
        FROM "Company" c
        JOIN "ChainNode" cn ON cn.id = c."chainNodeId"
        JOIN "IndustryChain" ic ON ic.id = cn."chainId"
        JOIN "Project" p ON p.id = ic."projectId"
        WHERE ic.status = 'COMPLETED'
        GROUP BY p.industry
        ORDER BY p.industry
      `;

      // Analysis logs with pagination
      const logTotal = await ctx.db.$queryRaw<[{count: number}]>`
        SELECT COUNT(*)::int as count FROM "AnalysisLog"
      `.catch(() => [{count: 0}]);

      const recentLogs = await ctx.db.$queryRaw<Array<{
        companyName: string;
        industry: string;
        nodeName: string;
        status: string;
        durationSec: number;
        costUsd: number;
        createdAt: string;
      }>>`
        SELECT "companyName", industry, "nodeName", status,
          "durationSec", "costUsd"::float,
          to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'HH24:MI:SS') as "createdAt"
        FROM "AnalysisLog"
        ORDER BY id DESC
        LIMIT 200
      `.catch(() => []);

      const logTotalCount = logTotal[0]?.count ?? 0;

      return { industries: results, analysisProgress, recentLogs, logTotalCount };
    }),

  companyData: protectedProcedure
    .input(z.object({
      teamId: z.string(),
      page: z.number().default(0),
      pageSize: z.number().default(30),
      industry: z.string().default("all"),
      source: z.string().default("all"),
    }))
    .query(async ({ ctx, input }) => {
      const where: any = {
        chainNode: { chain: { status: "COMPLETED" } },
      };

      if (input.industry !== "all") {
        where.chainNode = { chain: { status: "COMPLETED", project: { industry: input.industry } } };
      }

      if (input.source === "live") {
        where.liveMarketCap = { not: null };
      } else if (input.source === "ai") {
        where.liveMarketCap = null;
        where.isPublic = true;
      }

      const [companies, total] = await Promise.all([
        ctx.db.company.findMany({
          where,
          select: {
            id: true, name: true, ticker: true, exchange: true,
            marketCap: true, revenue: true, revenueGrowth: true,
            grossMargin: true, netMargin: true, marketPosition: true,
            liveMarketCap: true, liveRevenue: true, liveRevenueGrowth: true,
            liveGrossMargin: true, liveNetMargin: true, livePeRatio: true,
            liveForwardPE: true, liveChange: true, liveCurrency: true,
            liveUpdatedAt: true,
            chainNode: {
              select: {
                chain: { select: { project: { select: { industry: true } } } },
              },
            },
          },
          orderBy: [{ liveMarketCap: { sort: "desc", nulls: "last" } }, { name: "asc" }],
          skip: input.page * input.pageSize,
          take: input.pageSize,
        }),
        ctx.db.company.count({ where }),
      ]);

      // Stats
      const [totalCompanies, withLiveData, withMoat] = await Promise.all([
        ctx.db.company.count({ where: { chainNode: { chain: { status: "COMPLETED" } } } }),
        ctx.db.company.count({ where: { chainNode: { chain: { status: "COMPLETED" } }, liveMarketCap: { not: null } } }),
        ctx.db.company.count({ where: { chainNode: { chain: { status: "COMPLETED" } }, moat: { not: null } } }),
      ]);

      const industries = await ctx.db.$queryRaw<Array<{ industry: string }>>`
        SELECT DISTINCT p.industry FROM "Project" p
        JOIN "IndustryChain" ic ON ic."projectId" = p.id
        WHERE ic.status = 'COMPLETED'
        ORDER BY p.industry
      `;

      return {
        companies: companies.map((c) => ({
          ...c,
          industry: c.chainNode?.chain?.project?.industry ?? "",
          liveMarketCap: c.liveMarketCap?.toString() ?? null,
          liveRevenue: c.liveRevenue?.toString() ?? null,
          liveRevenueGrowth: c.liveRevenueGrowth?.toString() ?? null,
          liveGrossMargin: c.liveGrossMargin?.toString() ?? null,
          liveNetMargin: c.liveNetMargin?.toString() ?? null,
          livePeRatio: c.livePeRatio?.toString() ?? null,
          liveForwardPE: c.liveForwardPE?.toString() ?? null,
          liveChange: c.liveChange?.toString() ?? null,
        })),
        total,
        stats: {
          totalCompanies,
          withLiveData,
          withoutLiveData: totalCompanies - withLiveData,
          withMoat,
          industries: industries.map((i) => i.industry),
        },
      };
    }),
});
