import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { createTestUser, createTestTeam, createTestProject } from "../helpers";
import {
  syncYjsNodeToPrisma,
  syncPrismaNodeToYjs,
} from "@/server/collab/yjs-prisma-sync";
import {
  createEmptyYjsDoc,
} from "@/server/collab/yjs-schema";

describe("Yjs <-> Prisma Sync", () => {
  it("persists a Yjs node change to Prisma", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createTestProject(team.id);

    const chain = await db.industryChain.create({
      data: { projectId: project.id, status: "COMPLETED", maxDepth: 3 },
    });

    // Create the node in Prisma first
    const node = await db.chainNode.create({
      data: {
        chainId: chain.id,
        name: "Original Name",
        description: "Original",
        nodeType: "UPSTREAM",
        level: 0,
        order: 0,
      },
    });

    // Simulate Yjs update
    await syncYjsNodeToPrisma(db, {
      id: node.id,
      name: "Updated via Yjs",
      description: "Updated desc",
      nodeType: "UPSTREAM",
      level: 0,
      order: 0,
      parentId: null,
    });

    const updated = await db.chainNode.findUnique({ where: { id: node.id } });
    expect(updated!.name).toBe("Updated via Yjs");
    expect(updated!.description).toBe("Updated desc");
  });

  it("loads Prisma node into Yjs document", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createTestProject(team.id);

    const chain = await db.industryChain.create({
      data: { projectId: project.id, status: "COMPLETED", maxDepth: 3 },
    });

    await db.chainNode.create({
      data: {
        chainId: chain.id,
        name: "From DB",
        description: "DB node",
        nodeType: "MIDSTREAM",
        level: 0,
        order: 0,
      },
    });

    const doc = createEmptyYjsDoc();
    await syncPrismaNodeToYjs(db, chain.id, doc);

    const chainNodes = doc.getMap("chainNodes");
    expect(chainNodes.size).toBe(1);
  });
});
