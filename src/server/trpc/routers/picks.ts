/**
 * Top Picks Router — AI-powered investment picks per industry
 * Uses live financial data + chokepoint analysis to rank companies
 */
import { z } from "zod";
import { createRouter, protectedProcedure } from "../init";

export const picksRouter = createRouter({
  /**
   * Get top investment picks for an industry
   */
  byIndustry: protectedProcedure
    .input(z.object({ teamId: z.string(), industry: z.string() }))
    .query(async ({ ctx, input }) => {
      // Score and rank companies using live financial data
      const picks = await ctx.db.$queryRaw<Array<{
        id: string;
        name: string;
        ticker: string;
        exchange: string;
        nodeName: string;
        nodeType: string;
        marketPosition: string;
        mcapB: number;
        revB: number;
        growth: number;
        gm: number;
        nm: number;
        pe: number;
        fwdPe: number;
        peg: number;
        ps: number;
        fcfYield: number;
        beta: number;
        moat: string;
        highlights: string[];
        risks: string[];
        analystRating: string;
        marketShare: string;
        score: number;
      }>>`
        WITH scored AS (
          SELECT
            c.id,
            c.name,
            c.ticker,
            c.exchange,
            cn.name as "nodeName",
            cn."nodeType",
            c."marketPosition",
            c."liveMarketCap"::float / 1e9 as "mcapB",
            c."liveRevenue"::float / 1e9 as "revB",
            c."liveRevenueGrowth"::float as growth,
            c."liveGrossMargin"::float as gm,
            c."liveNetMargin"::float as nm,
            c."livePeRatio"::float as pe,
            c."liveForwardPE"::float as "fwdPe",
            c."livePegRatio"::float as peg,
            CASE WHEN c."liveRevenue" > 0 THEN c."liveMarketCap"::float / c."liveRevenue"::float ELSE NULL END as ps,
            CASE WHEN c."liveMarketCap" > 0 AND c."liveFreeCashflow" > 0
              THEN c."liveFreeCashflow"::float / c."liveMarketCap"::float * 100 ELSE NULL END as "fcfYield",
            c."liveBeta"::float as beta,
            c.moat,
            c.highlights,
            c.risks,
            c."analystRating",
            c."marketShare",
            (
              LEAST(COALESCE(c."liveRevenueGrowth"::float, 0), 100) * 1.5
              + COALESCE(c."liveGrossMargin"::float, 0) * 0.8
              + CASE
                  WHEN c."livePegRatio"::float BETWEEN 0.1 AND 0.5 THEN 40
                  WHEN c."livePegRatio"::float BETWEEN 0.5 AND 1.0 THEN 30
                  WHEN c."livePegRatio"::float BETWEEN 1.0 AND 1.5 THEN 15
                  WHEN c."livePegRatio"::float BETWEEN 1.5 AND 2.5 THEN 5
                  ELSE 0 END
              + CASE WHEN c."liveForwardPE"::float > 0 AND c."livePeRatio"::float > 0
                      AND c."liveForwardPE"::float < c."livePeRatio"::float * 0.7 THEN 25 ELSE 0 END
              + CASE WHEN c."liveFreeCashflow" > 0 THEN 15 ELSE -5 END
              + CASE WHEN c."liveMarketCap" > 0 AND c."liveFreeCashflow" > 0
                      AND c."liveFreeCashflow"::float / c."liveMarketCap"::float > 0.03 THEN 20 ELSE 0 END
              + CASE WHEN c.moat IS NOT NULL THEN 10 ELSE 0 END
              + CASE WHEN cn."nodeType" = 'UPSTREAM' THEN 8 ELSE 0 END
              - CASE WHEN c."livePeRatio"::float > 150 THEN 30
                      WHEN c."livePeRatio"::float > 80 THEN 15
                      WHEN c."livePeRatio"::float > 50 THEN 5
                      ELSE 0 END
              - CASE WHEN c."liveMarketCap"::float > 2e12 THEN 20
                      WHEN c."liveMarketCap"::float > 5e11 THEN 10
                      WHEN c."liveMarketCap"::float > 1e11 THEN 5
                      ELSE 0 END
              - CASE WHEN c."liveRevenue" > 0 AND c."liveMarketCap"::float / c."liveRevenue"::float > 30 THEN 25
                      WHEN c."liveRevenue" > 0 AND c."liveMarketCap"::float / c."liveRevenue"::float > 15 THEN 10
                      ELSE 0 END
            ) as score,
            ROW_NUMBER() OVER (PARTITION BY c.ticker ORDER BY
              CASE WHEN cn."nodeType" = 'UPSTREAM' THEN 0 ELSE 1 END,
              CASE WHEN c.moat IS NOT NULL THEN 0 ELSE 1 END
            ) as rn
          FROM "Company" c
          JOIN "ChainNode" cn ON cn.id = c."chainNodeId"
          JOIN "IndustryChain" ic ON ic.id = cn."chainId"
          JOIN "Project" p ON p.id = ic."projectId"
          WHERE p.industry = ${input.industry}
            AND c."liveMarketCap" IS NOT NULL
            AND c."liveRevenue" IS NOT NULL
            AND c."liveMarketCap" > 1e9
        )
        SELECT * FROM scored WHERE rn = 1
        ORDER BY score DESC
        LIMIT 10
      `;

      return picks.map((p) => ({
        ...p,
        mcapB: p.mcapB ? Number(Number(p.mcapB).toFixed(1)) : null,
        revB: p.revB ? Number(Number(p.revB).toFixed(1)) : null,
        growth: p.growth ? Number(Number(p.growth).toFixed(1)) : null,
        gm: p.gm ? Number(Number(p.gm).toFixed(1)) : null,
        nm: p.nm ? Number(Number(p.nm).toFixed(1)) : null,
        pe: p.pe ? Number(Number(p.pe).toFixed(1)) : null,
        fwdPe: p.fwdPe ? Number(Number(p.fwdPe).toFixed(1)) : null,
        peg: p.peg ? Number(Number(p.peg).toFixed(2)) : null,
        ps: p.ps ? Number(Number(p.ps).toFixed(1)) : null,
        fcfYield: p.fcfYield ? Number(Number(p.fcfYield).toFixed(1)) : null,
        beta: p.beta ? Number(Number(p.beta).toFixed(2)) : null,
        score: Number(Number(p.score).toFixed(0)),
      }));
    }),

  /**
   * Get all industries that have picks available
   */
  industries: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ ctx }) => {
      const industries = await ctx.db.$queryRaw<Array<{ industry: string; name: string; companyCount: number }>>`
        SELECT p.industry, p.name,
          (SELECT COUNT(*) FROM "Company" c
           JOIN "ChainNode" cn ON cn.id = c."chainNodeId"
           WHERE cn."chainId" = ic.id AND c."liveMarketCap" IS NOT NULL) as "companyCount"
        FROM "Project" p
        JOIN "IndustryChain" ic ON ic."projectId" = p.id
        WHERE ic.status = 'COMPLETED'
        ORDER BY p."createdAt"
      `;
      return industries.filter((i) => Number(i.companyCount) > 0);
    }),
});
