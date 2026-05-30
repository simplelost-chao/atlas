import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { createTestUser, createTestTeam, createTestProject } from "../helpers";
import {
  createComment,
  listComments,
  deleteComment,
} from "@/server/trpc/routers/comment";

describe("Comments", () => {
  it("creates a comment on a node", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createTestProject(team.id);
    const chain = await db.industryChain.create({
      data: { projectId: project.id, status: "COMPLETED", maxDepth: 3 },
    });
    const node = await db.chainNode.create({
      data: {
        chainId: chain.id,
        name: "Test",
        description: "",
        nodeType: "UPSTREAM",
        level: 0,
        order: 0,
      },
    });

    const comment = await createComment({
      chainId: chain.id,
      targetType: "NODE",
      targetId: node.id,
      userId: user.id,
      content: "This node needs more analysis",
    });

    expect(comment.content).toBe("This node needs more analysis");
    expect(comment.targetId).toBe(node.id);
  });

  it("lists comments for a target", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createTestProject(team.id);
    const chain = await db.industryChain.create({
      data: { projectId: project.id, status: "COMPLETED", maxDepth: 3 },
    });
    const node = await db.chainNode.create({
      data: {
        chainId: chain.id,
        name: "Test",
        description: "",
        nodeType: "UPSTREAM",
        level: 0,
        order: 0,
      },
    });

    await createComment({
      chainId: chain.id,
      targetType: "NODE",
      targetId: node.id,
      userId: user.id,
      content: "Comment 1",
    });
    await createComment({
      chainId: chain.id,
      targetType: "NODE",
      targetId: node.id,
      userId: user.id,
      content: "Comment 2",
    });

    const comments = await listComments(chain.id, node.id);
    expect(comments).toHaveLength(2);
  });

  it("deletes a comment", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createTestProject(team.id);
    const chain = await db.industryChain.create({
      data: { projectId: project.id, status: "COMPLETED", maxDepth: 3 },
    });
    const node = await db.chainNode.create({
      data: {
        chainId: chain.id,
        name: "Test",
        description: "",
        nodeType: "UPSTREAM",
        level: 0,
        order: 0,
      },
    });

    const comment = await createComment({
      chainId: chain.id,
      targetType: "NODE",
      targetId: node.id,
      userId: user.id,
      content: "To delete",
    });

    await deleteComment(comment.id, user.id);

    const remaining = await listComments(chain.id, node.id);
    expect(remaining).toHaveLength(0);
  });
});
