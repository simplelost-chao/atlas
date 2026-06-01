/**
 * One-time backfill: populate normKey for existing ChainNode and Company rows.
 *
 * Run after applying migration 20260601000000_add_entity_resolution_fields:
 *   npx tsx scripts/backfill-normkey.ts
 */
import { PrismaClient } from "@prisma/client";
import { normalize } from "../src/server/lib/normalize";

const db = new PrismaClient();

async function main() {
  const nodes = await db.chainNode.findMany({
    where: { normKey: "" },
    select: { id: true, name: true },
  });
  console.log(`Backfilling ${nodes.length} ChainNode rows...`);
  for (const n of nodes) {
    await db.chainNode.update({ where: { id: n.id }, data: { normKey: normalize(n.name) } });
  }
  console.log(`  done.`);

  const companies = await db.company.findMany({
    where: { normKey: "" },
    select: { id: true, name: true },
  });
  console.log(`Backfilling ${companies.length} Company rows...`);
  for (const c of companies) {
    await db.company.update({ where: { id: c.id }, data: { normKey: normalize(c.name) } });
  }
  console.log(`  done.`);
  console.log("Backfill complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
