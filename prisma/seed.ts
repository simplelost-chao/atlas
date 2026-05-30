import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  // Create demo user
  const user = await prisma.user.upsert({
    where: { email: "demo@atlas.dev" },
    update: {},
    create: {
      email: "demo@atlas.dev",
      name: "Demo User",
      passwordHash,
    },
  });

  // Create demo team
  const team = await prisma.team.create({
    data: {
      name: "Demo Team",
      members: {
        create: { userId: user.id, role: "OWNER" },
      },
    },
  });

  // Create demo project
  await prisma.project.create({
    data: {
      teamId: team.id,
      name: "AI 产业链分析",
      industry: "AI",
      description: "人工智能上下游产业链全景分析",
    },
  });

  console.log("Seed complete: demo@atlas.dev / password123");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
