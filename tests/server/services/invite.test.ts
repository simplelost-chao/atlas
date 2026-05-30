import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { createTestUser, createTestTeam } from "../../helpers";
import {
  createInvite,
  acceptInvite,
  listPendingInvites,
} from "@/server/services/invite";

describe("Invite service", () => {
  it("creates an invite with token and expiry", async () => {
    const owner = await createTestUser();
    const team = await createTestTeam(owner.id);

    const invite = await createInvite(team.id, "invited@example.com", "EDITOR");

    expect(invite.token).toBeDefined();
    expect(invite.email).toBe("invited@example.com");
    expect(invite.role).toBe("EDITOR");
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts an invite and adds user to team", async () => {
    const owner = await createTestUser({ email: "owner@test.com" });
    const team = await createTestTeam(owner.id);
    const invite = await createInvite(team.id, "new@test.com", "EDITOR");

    const newUser = await createTestUser({ email: "new@test.com" });
    const membership = await acceptInvite(invite.token, newUser.id);

    expect(membership.teamId).toBe(team.id);
    expect(membership.role).toBe("EDITOR");

    // Invite should be deleted after acceptance
    const deletedInvite = await db.teamInvite.findUnique({
      where: { id: invite.id },
    });
    expect(deletedInvite).toBeNull();
  });

  it("rejects expired invites", async () => {
    const owner = await createTestUser();
    const team = await createTestTeam(owner.id);

    // Create an already-expired invite
    const invite = await db.teamInvite.create({
      data: {
        teamId: team.id,
        email: "late@test.com",
        role: "EDITOR",
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      },
    });

    const user = await createTestUser({ email: "late@test.com" });
    await expect(acceptInvite(invite.token, user.id)).rejects.toThrow(
      "Invite has expired"
    );
  });

  it("lists pending invites for a team", async () => {
    const owner = await createTestUser();
    const team = await createTestTeam(owner.id);
    await createInvite(team.id, "a@test.com", "EDITOR");
    await createInvite(team.id, "b@test.com", "VIEWER");

    const invites = await listPendingInvites(team.id);
    expect(invites).toHaveLength(2);
  });
});
