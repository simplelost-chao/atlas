import { db } from "@/server/db";
import bcrypt from "bcryptjs";
import type { TeamRole } from "@prisma/client";

export async function createTestUser(overrides?: {
  email?: string;
  name?: string;
  password?: string;
}) {
  const email = overrides?.email ?? `test-${Date.now()}@example.com`;
  const password = overrides?.password ?? "password123";

  return db.user.create({
    data: {
      email,
      name: overrides?.name ?? "Test User",
      passwordHash: await bcrypt.hash(password, 10),
    },
  });
}

export async function createTestTeam(ownerId: string, name?: string) {
  const team = await db.team.create({
    data: {
      name: name ?? "Test Team",
      members: {
        create: {
          userId: ownerId,
          role: "OWNER",
        },
      },
    },
  });
  return team;
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole = "EDITOR"
) {
  return db.teamMember.create({
    data: { teamId, userId, role },
  });
}

export async function createTestProject(
  teamId: string,
  overrides?: { name?: string; industry?: string }
) {
  return db.project.create({
    data: {
      teamId,
      name: overrides?.name ?? "Test Project",
      industry: overrides?.industry ?? "AI",
    },
  });
}
