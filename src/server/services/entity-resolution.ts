/**
 * Entity resolution for the supply-chain graph.
 *
 * Finds whether a ChainNode or Company already exists for a given name, so the
 * generation pipeline can do find-or-create instead of blindly inserting
 * duplicates. Matching is by normalized name (see `normalize`) plus an explicit
 * `aliases` list, so "InP" / "Indium Phosphide" / "磷化铟" resolve to one node.
 *
 * Phase 1 scope: node matching is chain-scoped (preserves atlas's per-Project
 * isolation). Company matching is global (a listed company may appear under
 * multiple chain nodes).
 *
 * Ported from IndustryAnalysis Python (industry_analysis.graph.store.find_by_name).
 */
import type { PrismaClient } from "@prisma/client";
import { normalize } from "../lib/normalize";

export interface NodeMatch {
  id: string;
}

/**
 * Find an existing ChainNode in the given chain whose name or any alias
 * normalizes to the same key as `name`.
 * Returns null if none match or the name normalizes to an empty key.
 */
export async function findNodeByName(
  db: PrismaClient,
  chainId: string,
  name: string
): Promise<NodeMatch | null> {
  const key = normalize(name);
  if (!key) return null;

  // Primary: normKey index lookup (fast)
  const byKey = await db.chainNode.findFirst({
    where: { chainId, normKey: key },
    select: { id: true },
  });
  if (byKey) return byKey;

  // Secondary: alias array contains the raw name, then normalize-compare in JS
  const candidates = await db.chainNode.findMany({
    where: { chainId, aliases: { has: name } },
    select: { id: true, aliases: true },
  });
  for (const c of candidates) {
    if (c.aliases.some((a) => normalize(a) === key)) return { id: c.id };
  }
  return null;
}

/**
 * Find an existing Company by ticker (case-insensitive, strongest signal)
 * or by normalized name.
 * Company resolution is global — the same listed company can appear under
 * multiple chain nodes.
 */
export async function findCompanyByTickerOrName(
  db: PrismaClient,
  name: string,
  ticker?: string | null
): Promise<NodeMatch | null> {
  if (ticker) {
    const byTicker = await db.company.findFirst({
      where: { ticker: { equals: ticker, mode: "insensitive" } },
      select: { id: true },
    });
    if (byTicker) return byTicker;
  }

  const key = normalize(name);
  if (!key) return null;

  const byKey = await db.company.findFirst({
    where: { normKey: key },
    select: { id: true },
  });
  if (byKey) return byKey;

  const candidates = await db.company.findMany({
    where: { aliases: { has: name } },
    select: { id: true, aliases: true },
  });
  for (const c of candidates) {
    if (c.aliases.some((a) => normalize(a) === key)) return { id: c.id };
  }
  return null;
}
