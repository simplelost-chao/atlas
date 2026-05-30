import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { createTestUser, createTestTeam, addTeamMember } from "../helpers";
import {
  createTeam,
  listUserTeams,
  updateTeam,
  getTeamMembers,
  updateMemberRole,
  removeMember,
} from "@/server/trpc/routers/team";

describe("Team operations", () => {
  describe("createTeam", () => {
    it("creates a team and adds creator as OWNER", async () => {
      const user = await createTestUser();
      const team = await createTeam(user.id, "Research Team");

      expect(team.name).toBe("Research Team");

      const member = await db.teamMember.findUnique({
        where: { teamId_userId: { teamId: team.id, userId: user.id } },
      });
      expect(member!.role).toBe("OWNER");
    });
  });

  describe("listUserTeams", () => {
    it("returns all teams a user belongs to", async () => {
      const user = await createTestUser();
      await createTeam(user.id, "Team A");
      await createTeam(user.id, "Team B");

      const teams = await listUserTeams(user.id);
      expect(teams).toHaveLength(2);
      expect(teams.map((t) => t.name).sort()).toEqual(["Team A", "Team B"]);
    });
  });

  describe("updateTeam", () => {
    it("allows OWNER to rename team", async () => {
      const user = await createTestUser();
      const team = await createTeam(user.id, "Old Name");

      const updated = await updateTeam(team.id, { name: "New Name" });
      expect(updated.name).toBe("New Name");
    });
  });

  describe("getTeamMembers", () => {
    it("returns all members with roles", async () => {
      const owner = await createTestUser({ email: "owner@test.com" });
      const editor = await createTestUser({ email: "editor@test.com" });
      const team = await createTeam(owner.id, "Team");
      await addTeamMember(team.id, editor.id, "EDITOR");

      const members = await getTeamMembers(team.id);
      expect(members).toHaveLength(2);
    });
  });

  describe("updateMemberRole", () => {
    it("changes a member role", async () => {
      const owner = await createTestUser({ email: "owner@test.com" });
      const member = await createTestUser({ email: "member@test.com" });
      const team = await createTeam(owner.id, "Team");
      await addTeamMember(team.id, member.id, "VIEWER");

      await updateMemberRole(team.id, member.id, "EDITOR");

      const updated = await db.teamMember.findUnique({
        where: { teamId_userId: { teamId: team.id, userId: member.id } },
      });
      expect(updated!.role).toBe("EDITOR");
    });
  });

  describe("removeMember", () => {
    it("removes a member from the team", async () => {
      const owner = await createTestUser({ email: "owner@test.com" });
      const member = await createTestUser({ email: "member@test.com" });
      const team = await createTeam(owner.id, "Team");
      await addTeamMember(team.id, member.id, "EDITOR");

      await removeMember(team.id, member.id);

      const check = await db.teamMember.findUnique({
        where: { teamId_userId: { teamId: team.id, userId: member.id } },
      });
      expect(check).toBeNull();
    });
  });
});
