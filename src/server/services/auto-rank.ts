/**
 * Auto-Rank Service
 *
 * Automatically calculates market position (LEADER/CHALLENGER/EMERGING/NICHE)
 * based on real financial data instead of AI guessing.
 *
 * Rules:
 * - Within each chain node, rank companies by liveMarketCap
 * - Top 1-2 (with market cap > 2x the 3rd) → LEADER
 * - Top 3-5 → CHALLENGER
 * - Market cap < 50% of median → NICHE
 * - Rest → EMERGING
 * - Special: market share > 30% regardless of market cap → LEADER (niche monopoly)
 * - Non-public companies with no live data → keep existing or EMERGING
 */

import type { PrismaClient } from "@prisma/client";

interface RankResult {
  companyId: string;
  name: string;
  oldPosition: string;
  newPosition: string;
  liveMarketCap: number | null;
}

/**
 * Auto-rank all companies within a single chain node.
 */
export async function autoRankNode(
  db: PrismaClient,
  nodeId: string
): Promise<RankResult[]> {
  const companies = await db.company.findMany({
    where: { chainNodeId: nodeId },
    select: {
      id: true,
      name: true,
      liveMarketCap: true,
      marketShare: true,
      marketPosition: true,
      isPublic: true,
    },
    orderBy: { liveMarketCap: "desc" },
  });

  if (companies.length === 0) return [];

  const withMcap = companies
    .filter((c) => c.liveMarketCap != null)
    .sort((a, b) => Number(b.liveMarketCap!) - Number(a.liveMarketCap!));

  const medianMcap =
    withMcap.length > 0
      ? Number(withMcap[Math.floor(withMcap.length / 2)].liveMarketCap!)
      : 0;

  const thirdMcap =
    withMcap.length >= 3 ? Number(withMcap[2].liveMarketCap!) : 0;

  const results: RankResult[] = [];

  for (const c of companies) {
    const oldPosition = c.marketPosition;
    let newPosition: string;

    if (c.liveMarketCap == null) {
      // No live data — private company or data not synced
      newPosition = c.isPublic ? "EMERGING" : (oldPosition ?? "EMERGING");
    } else {
      const mcap = Number(c.liveMarketCap);
      const rank = withMcap.findIndex((w) => w.id === c.id);

      if (rank <= 1 && (withMcap.length < 3 || mcap > thirdMcap * 2)) {
        newPosition = "LEADER";
      } else if (rank <= 4) {
        newPosition = "CHALLENGER";
      } else if (medianMcap > 0 && mcap < medianMcap * 0.5) {
        newPosition = "NICHE";
      } else {
        newPosition = "EMERGING";
      }
    }

    // Special: high market share = leader regardless of market cap
    if (c.marketShare) {
      const shareNum = parseInt(c.marketShare);
      if (!isNaN(shareNum) && shareNum >= 30 && newPosition !== "LEADER") {
        newPosition = "LEADER";
      }
    }

    if (newPosition !== oldPosition) {
      await db.company.update({
        where: { id: c.id },
        data: { marketPosition: newPosition as any },
      });
    }

    results.push({
      companyId: c.id,
      name: c.name,
      oldPosition,
      newPosition,
      liveMarketCap: c.liveMarketCap ? Number(c.liveMarketCap) : null,
    });
  }

  return results;
}

/**
 * Auto-rank all companies across all nodes in a chain.
 */
export async function autoRankChain(
  db: PrismaClient,
  chainId: string
): Promise<{ nodesProcessed: number; companiesRanked: number; positionsChanged: number }> {
  const nodes = await db.chainNode.findMany({
    where: { chainId },
    select: { id: true },
  });

  let companiesRanked = 0;
  let positionsChanged = 0;

  for (const node of nodes) {
    const results = await autoRankNode(db, node.id);
    companiesRanked += results.length;
    positionsChanged += results.filter((r) => r.oldPosition !== r.newPosition).length;
  }

  return {
    nodesProcessed: nodes.length,
    companiesRanked,
    positionsChanged,
  };
}

/**
 * Auto-rank all companies across all completed chains.
 */
export async function autoRankAll(
  db: PrismaClient
): Promise<{ chainsProcessed: number; companiesRanked: number; positionsChanged: number }> {
  const chains = await db.industryChain.findMany({
    where: { status: "COMPLETED" },
    select: { id: true },
  });

  let totalCompanies = 0;
  let totalChanged = 0;

  for (const chain of chains) {
    const result = await autoRankChain(db, chain.id);
    totalCompanies += result.companiesRanked;
    totalChanged += result.positionsChanged;
  }

  return {
    chainsProcessed: chains.length,
    companiesRanked: totalCompanies,
    positionsChanged: totalChanged,
  };
}
