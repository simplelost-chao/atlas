import { TRPCError } from "@trpc/server";
import { db } from "../db";
import type { TeamRole } from "@prisma/client";

const INVITE_EXPIRY_DAYS = 7;

export async function createInvite(
  teamId: string,
  email: string,
  role: TeamRole
) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  return db.teamInvite.create({
    data: {
      teamId,
      email,
      role,
      expiresAt,
    },
  });
}

export async function acceptInvite(token: string, userId: string) {
  const invite = await db.teamInvite.findUnique({
    where: { token },
  });

  if (!invite) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
  }

  if (invite.expiresAt < new Date()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invite has expired",
    });
  }

  const membership = await db.$transaction(async (tx) => {
    const member = await tx.teamMember.upsert({
      where: {
        teamId_userId: { teamId: invite.teamId, userId },
      },
      update: { role: invite.role },
      create: {
        teamId: invite.teamId,
        userId,
        role: invite.role,
      },
    });

    await tx.teamInvite.delete({ where: { id: invite.id } });

    return member;
  });

  return membership;
}

export async function listPendingInvites(teamId: string) {
  return db.teamInvite.findMany({
    where: {
      teamId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}
