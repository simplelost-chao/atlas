import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { createTestUser, createTestTeam } from "../helpers";
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from "@/server/trpc/routers/project";

describe("Project operations", () => {
  it("creates a project with industry keyword", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);

    const project = await createProject(team.id, {
      name: "AI Investment Research",
      industry: "AI",
      description: "Mapping the AI supply chain",
    });

    expect(project.name).toBe("AI Investment Research");
    expect(project.industry).toBe("AI");
    expect(project.teamId).toBe(team.id);
  });

  it("lists projects for a team", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    await createProject(team.id, { name: "AI", industry: "AI" });
    await createProject(team.id, { name: "Semiconductor", industry: "半导体" });

    const projects = await listProjects(team.id);
    expect(projects).toHaveLength(2);
  });

  it("gets a project by id with chain status", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createProject(team.id, {
      name: "AI",
      industry: "AI",
    });

    const found = await getProject(project.id, team.id);
    expect(found!.name).toBe("AI");
    expect(found!.chain).toBeNull(); // No chain generated yet
  });

  it("updates a project", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createProject(team.id, {
      name: "AI",
      industry: "AI",
    });

    const updated = await updateProject(project.id, team.id, {
      name: "AI Research v2",
    });
    expect(updated.name).toBe("AI Research v2");
  });

  it("deletes a project", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createProject(team.id, {
      name: "AI",
      industry: "AI",
    });

    await deleteProject(project.id, team.id);

    const found = await db.project.findUnique({
      where: { id: project.id },
    });
    expect(found).toBeNull();
  });
});
