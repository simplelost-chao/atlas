# Atlas Phase 4: Real-time Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real-time multi-user collaboration on industry chain analysis. Multiple team members can simultaneously edit nodes, annotate companies, leave comments, and see each other's cursors/selections — all synced via Yjs CRDT and persisted to PostgreSQL.

**Architecture:** Yjs handles client-side CRDT state with a Hocuspocus WebSocket server embedded in a custom Next.js server. The Hocuspocus server syncs Yjs documents to PostgreSQL on every change via a persistence hook. The Yjs document structure mirrors the chain data, with separate Y.Map/Y.Array structures for nodes, annotations, and comments. Awareness protocol handles online status and cursor positions.

**Tech Stack:** Yjs, y-websocket, @hocuspocus/server, @hocuspocus/extension-database, Next.js 16 custom server, Prisma v7, tRPC v11

---

## File Structure

```
atlas/
├── server.ts                              (custom Next.js server with Hocuspocus)
├── src/
│   ├── server/
│   │   ├── collab/
│   │   │   ├── hocuspocus.ts              (Hocuspocus server setup + extensions)
│   │   │   ├── yjs-schema.ts              (Yjs document schema definition)
│   │   │   ├── yjs-prisma-sync.ts         (bidirectional Yjs <-> Prisma sync)
│   │   │   └── awareness.ts              (awareness protocol helpers)
│   │   └── trpc/
│   │       └── routers/
│   │           └── comment.ts             (tRPC router for comments)
│   ├── lib/
│   │   └── yjs-provider.ts               (client-side Yjs provider hook)
│   ├── components/
│   │   ├── collab/
│   │   │   ├── collaboration-provider.tsx (React context for Yjs doc + awareness)
│   │   │   ├── online-users.tsx           (avatar bar showing online users)
│   │   │   ├── cursor-overlay.tsx         (selected-node indicators per user)
│   │   │   └── undo-redo-toolbar.tsx      (undo/redo buttons)
│   │   └── comments/
│   │       ├── comment-thread.tsx         (comment thread on a node/company)
│   │       ├── comment-input.tsx          (new comment input)
│   │       └── comment-sidebar.tsx        (all comments sidebar)
│   └── hooks/
│       ├── use-yjs-doc.ts                 (hook to access Yjs doc)
│       └── use-undo-manager.ts            (hook wrapping Y.UndoManager)
├── prisma/
│   └── schema.prisma                      (add Comment + CollabDocument models)
├── tests/
│   └── server/
│       └── collab/
│           ├── yjs-schema.test.ts         (Yjs doc structure tests)
│           ├── yjs-prisma-sync.test.ts    (sync logic tests)
│           └── comment.test.ts            (comments router tests)
```

---

### Task 1: Install Yjs + Hocuspocus and Set Up Custom Server

**Files:**
- Modify: `package.json`
- Create: `server.ts`
- Create: `src/server/collab/hocuspocus.ts`

- [ ] **Step 1: Install collaboration dependencies**

```bash
npm install yjs y-websocket @hocuspocus/server @hocuspocus/extension-database y-protocols lib0
npm install --save-dev @types/ws
```

- [ ] **Step 2: Add Comment and CollabDocument models to Prisma schema**

Add to `prisma/schema.prisma`:

```prisma
// ─── Collaboration ──────────────────────────────

model Comment {
  id          String   @id @default(cuid())
  chainId     String
  targetType  CommentTargetType
  targetId    String               // ChainNode or Company id
  userId      String
  content     String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([chainId, targetId])
}

enum CommentTargetType {
  NODE
  COMPANY
}

model CollabDocument {
  id         String   @id @default(cuid())
  chainId    String   @unique
  state      Bytes                  // Yjs encoded document state
  updatedAt  DateTime @updatedAt

  chain IndustryChain @relation(fields: [chainId], references: [id], onDelete: Cascade)
}
```

Also add the `comments` relation to the `User` model and `collabDocument` relation to the `IndustryChain` model:

```prisma
// In User model, add:
comments    Comment[]

// In IndustryChain model, add:
collabDocument CollabDocument?
```

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name add-collab-models
```

Expected: Migration applied successfully.

- [ ] **Step 4: Create Hocuspocus server setup**

Create `src/server/collab/hocuspocus.ts`:

```typescript
import { Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { db } from "../db";
import { initializeYjsDocument } from "./yjs-schema";
import * as Y from "yjs";

/**
 * Create the Hocuspocus WebSocket server with database persistence.
 *
 * Document names follow the pattern: "chain:<chainId>"
 */
export function createHocuspocusServer() {
  return new Hocuspocus({
    port: 0, // Port managed by the custom Next.js server
    extensions: [
      new Database({
        /**
         * Load document state from PostgreSQL.
         */
        fetch: async ({ documentName }) => {
          const chainId = extractChainId(documentName);
          if (!chainId) return null;

          const doc = await db.collabDocument.findUnique({
            where: { chainId },
          });

          return doc?.state ? Buffer.from(doc.state) : null;
        },

        /**
         * Persist document state to PostgreSQL on every change.
         */
        store: async ({ documentName, state }) => {
          const chainId = extractChainId(documentName);
          if (!chainId) return;

          await db.collabDocument.upsert({
            where: { chainId },
            create: {
              chainId,
              state: Buffer.from(state),
            },
            update: {
              state: Buffer.from(state),
            },
          });
        },
      }),
    ],

    /**
     * Authenticate the WebSocket connection.
     * The token is passed as a query parameter from the client.
     */
    async onAuthenticate({ token, documentName }) {
      if (!token) {
        throw new Error("Authentication required");
      }

      // Validate the token (session token from NextAuth)
      const session = await db.session.findUnique({
        where: { sessionToken: token },
        include: { user: true },
      });

      if (!session || session.expires < new Date()) {
        throw new Error("Invalid or expired session");
      }

      // Verify user has access to the chain's team
      const chainId = extractChainId(documentName);
      if (!chainId) throw new Error("Invalid document name");

      const chain = await db.industryChain.findUnique({
        where: { id: chainId },
        include: { project: true },
      });

      if (!chain) throw new Error("Chain not found");

      const member = await db.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: chain.project.teamId,
            userId: session.userId,
          },
        },
      });

      if (!member) throw new Error("Access denied");

      return {
        user: {
          id: session.userId,
          name: session.user.name,
          email: session.user.email,
          role: member.role,
        },
      };
    },

    /**
     * Initialize a new document with the chain data from the database.
     */
    async onLoadDocument({ document, documentName, context }) {
      const chainId = extractChainId(documentName);
      if (!chainId) return;

      // Only initialize if the document is empty
      const chainNodes = document.getMap("chainNodes");
      if (chainNodes.size === 0) {
        await initializeYjsDocument(document, chainId, db);
      }
    },
  });
}

function extractChainId(documentName: string): string | null {
  const match = documentName.match(/^chain:(.+)$/);
  return match ? match[1] : null;
}
```

- [ ] **Step 5: Create the custom Next.js server**

Create `server.ts`:

```typescript
import { createServer } from "http";
import next from "next";
import { parse } from "url";
import { createHocuspocusServer } from "./src/server/collab/hocuspocus";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  const hocuspocus = createHocuspocusServer();

  await app.prepare();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Handle WebSocket upgrades
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url!, true);

    if (pathname === "/collab") {
      hocuspocus.handleConnection(socket as any, req as any);
    } else {
      // Let Next.js handle other WebSocket connections (HMR, etc.)
      socket.destroy();
    }
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Hocuspocus WebSocket on ws://${hostname}:${port}/collab`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Update package.json scripts**

Add/modify scripts in `package.json`:

```json
"dev": "tsx server.ts",
"dev:next": "next dev",
"start": "NODE_ENV=production node server.js"
```

- [ ] **Step 7: Commit**

```bash
git add server.ts src/server/collab/hocuspocus.ts prisma/schema.prisma package.json
git commit -m "feat: add Hocuspocus WebSocket server with custom Next.js server"
```

---

### Task 2: Create Yjs Document Schema

**Files:**
- Create: `src/server/collab/yjs-schema.ts`
- Create: `tests/server/collab/yjs-schema.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/collab/yjs-schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createEmptyYjsDoc,
  setChainNode,
  getChainNode,
  deleteChainNode,
  setAnnotation,
  getAnnotation,
  addComment,
  getComments,
  type YjsChainNode,
} from "@/server/collab/yjs-schema";

describe("Yjs Document Schema", () => {
  describe("chainNodes Y.Map", () => {
    it("sets and gets a chain node", () => {
      const doc = createEmptyYjsDoc();

      const nodeData: YjsChainNode = {
        id: "node-1",
        name: "GPU芯片",
        description: "图形处理器",
        nodeType: "UPSTREAM",
        level: 1,
        order: 0,
        parentId: "root-1",
      };

      setChainNode(doc, nodeData);
      const retrieved = getChainNode(doc, "node-1");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("GPU芯片");
      expect(retrieved!.nodeType).toBe("UPSTREAM");
    });

    it("deletes a chain node", () => {
      const doc = createEmptyYjsDoc();

      setChainNode(doc, {
        id: "node-1",
        name: "Test",
        description: "",
        nodeType: "MIDSTREAM",
        level: 0,
        order: 0,
        parentId: null,
      });

      deleteChainNode(doc, "node-1");
      expect(getChainNode(doc, "node-1")).toBeNull();
    });
  });

  describe("annotations Y.Map", () => {
    it("sets and gets an annotation on a company", () => {
      const doc = createEmptyYjsDoc();

      setAnnotation(doc, "company-1", {
        userId: "user-1",
        text: "这家公司估值偏高",
        color: "#ff0000",
      });

      const annotation = getAnnotation(doc, "company-1");
      expect(annotation).not.toBeNull();
      expect(annotation!.text).toBe("这家公司估值偏高");
    });
  });

  describe("comments Y.Array", () => {
    it("adds and retrieves comments", () => {
      const doc = createEmptyYjsDoc();

      addComment(doc, {
        id: "comment-1",
        targetType: "NODE",
        targetId: "node-1",
        userId: "user-1",
        userName: "Alice",
        content: "这个环节需要更多分析",
        createdAt: Date.now(),
      });

      addComment(doc, {
        id: "comment-2",
        targetType: "NODE",
        targetId: "node-1",
        userId: "user-2",
        userName: "Bob",
        content: "同意",
        createdAt: Date.now(),
      });

      const comments = getComments(doc, "node-1");
      expect(comments).toHaveLength(2);
      expect(comments[0].content).toBe("这个环节需要更多分析");
    });
  });

  describe("cross-client sync", () => {
    it("syncs changes between two Yjs docs", () => {
      const doc1 = createEmptyYjsDoc();
      const doc2 = createEmptyYjsDoc();

      // Apply changes on doc1
      setChainNode(doc1, {
        id: "node-1",
        name: "GPU",
        description: "test",
        nodeType: "UPSTREAM",
        level: 0,
        order: 0,
        parentId: null,
      });

      // Sync doc1 -> doc2
      const stateVector = Y.encodeStateAsUpdate(doc1);
      Y.applyUpdate(doc2, stateVector);

      // doc2 should have the node
      const node = getChainNode(doc2, "node-1");
      expect(node).not.toBeNull();
      expect(node!.name).toBe("GPU");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/server/collab/yjs-schema.test.ts
```

Expected: FAIL — cannot find module `@/server/collab/yjs-schema`

- [ ] **Step 3: Implement Yjs document schema**

Create `src/server/collab/yjs-schema.ts`:

```typescript
import * as Y from "yjs";
import type { PrismaClient } from "@prisma/client";

// ─── Types ──────────────────────────────────────

export interface YjsChainNode {
  id: string;
  name: string;
  description: string;
  nodeType: string;
  level: number;
  order: number;
  parentId: string | null;
  profitMargin?: string | null;
  marketSize?: string | null;
  growthTrend?: string | null;
  keyDrivers?: string[];
  valueFlow?: string | null;
}

export interface YjsAnnotation {
  userId: string;
  text: string;
  color?: string;
  updatedAt?: number;
}

export interface YjsComment {
  id: string;
  targetType: "NODE" | "COMPANY";
  targetId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: number;
}

// ─── Document Creation ──────────────────────────

/**
 * Create an empty Yjs document with the standard Atlas schema structure.
 */
export function createEmptyYjsDoc(): Y.Doc {
  const doc = new Y.Doc();
  // Pre-initialize the shared types so they exist in the doc
  doc.getMap("chainNodes");
  doc.getMap("annotations");
  doc.getArray("comments");
  return doc;
}

/**
 * Initialize a Yjs document from database chain data.
 */
export async function initializeYjsDocument(
  doc: Y.Doc,
  chainId: string,
  db: PrismaClient
): Promise<void> {
  const nodes = await db.chainNode.findMany({
    where: { chainId },
  });

  const chainNodesMap = doc.getMap("chainNodes");

  doc.transact(() => {
    for (const node of nodes) {
      const nodeMap = new Y.Map();
      nodeMap.set("id", node.id);
      nodeMap.set("name", node.name);
      nodeMap.set("description", node.description);
      nodeMap.set("nodeType", node.nodeType);
      nodeMap.set("level", node.level);
      nodeMap.set("order", node.order);
      nodeMap.set("parentId", node.parentId);
      nodeMap.set("profitMargin", node.profitMargin);
      nodeMap.set("marketSize", node.marketSize);
      nodeMap.set("growthTrend", node.growthTrend);
      nodeMap.set("keyDrivers", node.keyDrivers);
      nodeMap.set("valueFlow", node.valueFlow);
      chainNodesMap.set(node.id, nodeMap);
    }
  });
}

// ─── ChainNode Operations ───────────────────────

export function setChainNode(doc: Y.Doc, data: YjsChainNode): void {
  const chainNodes = doc.getMap("chainNodes");

  doc.transact(() => {
    const nodeMap = new Y.Map();
    nodeMap.set("id", data.id);
    nodeMap.set("name", data.name);
    nodeMap.set("description", data.description);
    nodeMap.set("nodeType", data.nodeType);
    nodeMap.set("level", data.level);
    nodeMap.set("order", data.order);
    nodeMap.set("parentId", data.parentId);
    if (data.profitMargin !== undefined) nodeMap.set("profitMargin", data.profitMargin);
    if (data.marketSize !== undefined) nodeMap.set("marketSize", data.marketSize);
    if (data.growthTrend !== undefined) nodeMap.set("growthTrend", data.growthTrend);
    if (data.keyDrivers !== undefined) nodeMap.set("keyDrivers", data.keyDrivers);
    if (data.valueFlow !== undefined) nodeMap.set("valueFlow", data.valueFlow);
    chainNodes.set(data.id, nodeMap);
  });
}

export function getChainNode(doc: Y.Doc, nodeId: string): YjsChainNode | null {
  const chainNodes = doc.getMap("chainNodes");
  const nodeMap = chainNodes.get(nodeId) as Y.Map<any> | undefined;

  if (!nodeMap) return null;

  return {
    id: nodeMap.get("id"),
    name: nodeMap.get("name"),
    description: nodeMap.get("description"),
    nodeType: nodeMap.get("nodeType"),
    level: nodeMap.get("level"),
    order: nodeMap.get("order"),
    parentId: nodeMap.get("parentId"),
    profitMargin: nodeMap.get("profitMargin"),
    marketSize: nodeMap.get("marketSize"),
    growthTrend: nodeMap.get("growthTrend"),
    keyDrivers: nodeMap.get("keyDrivers"),
    valueFlow: nodeMap.get("valueFlow"),
  };
}

export function deleteChainNode(doc: Y.Doc, nodeId: string): void {
  const chainNodes = doc.getMap("chainNodes");
  doc.transact(() => {
    chainNodes.delete(nodeId);
  });
}

// ─── Annotation Operations ──────────────────────

export function setAnnotation(
  doc: Y.Doc,
  targetId: string,
  annotation: YjsAnnotation
): void {
  const annotations = doc.getMap("annotations");

  doc.transact(() => {
    const annoMap = new Y.Map();
    annoMap.set("userId", annotation.userId);
    annoMap.set("text", annotation.text);
    annoMap.set("color", annotation.color ?? "#fbbf24");
    annoMap.set("updatedAt", annotation.updatedAt ?? Date.now());
    annotations.set(targetId, annoMap);
  });
}

export function getAnnotation(
  doc: Y.Doc,
  targetId: string
): YjsAnnotation | null {
  const annotations = doc.getMap("annotations");
  const annoMap = annotations.get(targetId) as Y.Map<any> | undefined;

  if (!annoMap) return null;

  return {
    userId: annoMap.get("userId"),
    text: annoMap.get("text"),
    color: annoMap.get("color"),
    updatedAt: annoMap.get("updatedAt"),
  };
}

// ─── Comment Operations ─────────────────────────

export function addComment(doc: Y.Doc, comment: YjsComment): void {
  const comments = doc.getArray("comments");

  doc.transact(() => {
    const commentMap = new Y.Map();
    commentMap.set("id", comment.id);
    commentMap.set("targetType", comment.targetType);
    commentMap.set("targetId", comment.targetId);
    commentMap.set("userId", comment.userId);
    commentMap.set("userName", comment.userName);
    commentMap.set("content", comment.content);
    commentMap.set("createdAt", comment.createdAt);
    comments.push([commentMap]);
  });
}

export function getComments(doc: Y.Doc, targetId: string): YjsComment[] {
  const comments = doc.getArray("comments");
  const result: YjsComment[] = [];

  for (let i = 0; i < comments.length; i++) {
    const commentMap = comments.get(i) as Y.Map<any>;
    if (commentMap.get("targetId") === targetId) {
      result.push({
        id: commentMap.get("id"),
        targetType: commentMap.get("targetType"),
        targetId: commentMap.get("targetId"),
        userId: commentMap.get("userId"),
        userName: commentMap.get("userName"),
        content: commentMap.get("content"),
        createdAt: commentMap.get("createdAt"),
      });
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/server/collab/yjs-schema.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/collab/yjs-schema.ts tests/server/collab/yjs-schema.test.ts
git commit -m "feat: add Yjs document schema with chainNodes, annotations, and comments"
```

---

### Task 3: Bidirectional Yjs <-> Prisma Sync

**Files:**
- Create: `src/server/collab/yjs-prisma-sync.ts`
- Create: `tests/server/collab/yjs-prisma-sync.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/collab/yjs-prisma-sync.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { db } from "@/server/db";
import { createTestUser, createTestTeam, createTestProject } from "../helpers";
import {
  syncYjsNodeToPrisma,
  syncPrismaNodeToYjs,
  setupYjsObserver,
} from "@/server/collab/yjs-prisma-sync";
import {
  createEmptyYjsDoc,
  setChainNode,
  getChainNode,
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/server/collab/yjs-prisma-sync.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement sync layer**

Create `src/server/collab/yjs-prisma-sync.ts`:

```typescript
import * as Y from "yjs";
import type { PrismaClient } from "@prisma/client";
import type { YjsChainNode } from "./yjs-schema";
import { setChainNode } from "./yjs-schema";

/**
 * Persist a Yjs chain node change to PostgreSQL via Prisma.
 * Called when the Hocuspocus server detects a change in the chainNodes Y.Map.
 */
export async function syncYjsNodeToPrisma(
  db: PrismaClient,
  nodeData: YjsChainNode
): Promise<void> {
  await db.chainNode.update({
    where: { id: nodeData.id },
    data: {
      name: nodeData.name,
      description: nodeData.description,
      nodeType: nodeData.nodeType as any,
      level: nodeData.level,
      order: nodeData.order,
      parentId: nodeData.parentId,
      profitMargin: nodeData.profitMargin,
      marketSize: nodeData.marketSize,
      growthTrend: nodeData.growthTrend,
      keyDrivers: nodeData.keyDrivers ?? [],
      valueFlow: nodeData.valueFlow,
    },
  });
}

/**
 * Load all Prisma chain nodes into a Yjs document.
 * Used when initializing a new Yjs document from existing DB data.
 */
export async function syncPrismaNodeToYjs(
  db: PrismaClient,
  chainId: string,
  doc: Y.Doc
): Promise<void> {
  const nodes = await db.chainNode.findMany({
    where: { chainId },
  });

  doc.transact(() => {
    for (const node of nodes) {
      setChainNode(doc, {
        id: node.id,
        name: node.name,
        description: node.description,
        nodeType: node.nodeType,
        level: node.level,
        order: node.order,
        parentId: node.parentId,
        profitMargin: node.profitMargin,
        marketSize: node.marketSize,
        growthTrend: node.growthTrend,
        keyDrivers: node.keyDrivers,
        valueFlow: node.valueFlow,
      });
    }
  });
}

/**
 * Set up a Y.Map observer that syncs node changes to Prisma.
 * Debounces writes to avoid excessive DB calls during rapid edits.
 */
export function setupYjsObserver(
  doc: Y.Doc,
  db: PrismaClient
): () => void {
  const chainNodes = doc.getMap("chainNodes");
  const pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

  const observer = (event: Y.YMapEvent<any>) => {
    for (const [key, change] of event.changes.keys) {
      if (change.action === "update" || change.action === "add") {
        // Debounce: wait 500ms before persisting
        if (pendingUpdates.has(key)) {
          clearTimeout(pendingUpdates.get(key)!);
        }

        const timeout = setTimeout(async () => {
          pendingUpdates.delete(key);
          const nodeMap = chainNodes.get(key) as Y.Map<any> | undefined;
          if (!nodeMap) return;

          const nodeData: YjsChainNode = {
            id: nodeMap.get("id"),
            name: nodeMap.get("name"),
            description: nodeMap.get("description"),
            nodeType: nodeMap.get("nodeType"),
            level: nodeMap.get("level"),
            order: nodeMap.get("order"),
            parentId: nodeMap.get("parentId"),
            profitMargin: nodeMap.get("profitMargin"),
            marketSize: nodeMap.get("marketSize"),
            growthTrend: nodeMap.get("growthTrend"),
            keyDrivers: nodeMap.get("keyDrivers"),
            valueFlow: nodeMap.get("valueFlow"),
          };

          try {
            await syncYjsNodeToPrisma(db, nodeData);
          } catch (err) {
            console.error(`Failed to sync node ${key} to DB:`, err);
          }
        }, 500);

        pendingUpdates.set(key, timeout);
      } else if (change.action === "delete") {
        // Cancel any pending update for deleted nodes
        if (pendingUpdates.has(key)) {
          clearTimeout(pendingUpdates.get(key)!);
          pendingUpdates.delete(key);
        }

        // Optionally delete from DB
        db.chainNode.delete({ where: { id: key } }).catch((err) => {
          console.error(`Failed to delete node ${key} from DB:`, err);
        });
      }
    }
  };

  chainNodes.observe(observer);

  // Return cleanup function
  return () => {
    chainNodes.unobserve(observer);
    for (const timeout of pendingUpdates.values()) {
      clearTimeout(timeout);
    }
    pendingUpdates.clear();
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/server/collab/yjs-prisma-sync.test.ts
```

Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/collab/yjs-prisma-sync.ts tests/server/collab/yjs-prisma-sync.test.ts
git commit -m "feat: add bidirectional Yjs <-> Prisma sync layer with debounced writes"
```

---

### Task 4: Client-Side Collaboration Provider + Awareness

**Files:**
- Create: `src/lib/yjs-provider.ts`
- Create: `src/server/collab/awareness.ts`
- Create: `src/components/collab/collaboration-provider.tsx`
- Create: `src/components/collab/online-users.tsx`
- Create: `src/components/collab/cursor-overlay.tsx`

- [ ] **Step 1: Create awareness helpers**

Create `src/server/collab/awareness.ts`:

```typescript
import type { Awareness } from "y-protocols/awareness";

export interface UserAwareness {
  userId: string;
  userName: string;
  userColor: string;
  selectedNodeId: string | null;
  cursor: { x: number; y: number } | null;
}

const USER_COLORS = [
  "#ef4444", "#f59e0b", "#22c55e", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

/**
 * Generate a consistent color for a user based on their ID.
 */
export function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

/**
 * Set the local user's awareness state.
 */
export function setLocalAwareness(
  awareness: Awareness,
  user: { id: string; name: string }
): void {
  awareness.setLocalStateField("user", {
    userId: user.id,
    userName: user.name,
    userColor: getUserColor(user.id),
    selectedNodeId: null,
    cursor: null,
  } satisfies UserAwareness);
}

/**
 * Update the selected node in awareness.
 */
export function setSelectedNode(
  awareness: Awareness,
  nodeId: string | null
): void {
  const state = awareness.getLocalState();
  if (state?.user) {
    awareness.setLocalStateField("user", {
      ...state.user,
      selectedNodeId: nodeId,
    });
  }
}

/**
 * Get all remote users' awareness states.
 */
export function getRemoteUsers(awareness: Awareness): UserAwareness[] {
  const states = awareness.getStates();
  const localClientId = awareness.clientID;
  const users: UserAwareness[] = [];

  states.forEach((state, clientId) => {
    if (clientId !== localClientId && state.user) {
      users.push(state.user as UserAwareness);
    }
  });

  return users;
}
```

- [ ] **Step 2: Create client-side Yjs provider hook**

Create `src/lib/yjs-provider.ts`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";

interface UseYjsProviderOptions {
  documentName: string;
  token: string;
  wsUrl?: string;
}

interface YjsProviderState {
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
  connected: boolean;
  synced: boolean;
}

export function useYjsProvider(
  options: UseYjsProviderOptions | null
): YjsProviderState | null {
  const [state, setState] = useState<YjsProviderState | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const docRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    if (!options) return;

    const { documentName, token, wsUrl } = options;
    const url = wsUrl ?? `ws://${window.location.host}/collab`;

    const doc = new Y.Doc();
    const provider = new WebsocketProvider(url, documentName, doc, {
      params: { token },
    });

    docRef.current = doc;
    providerRef.current = provider;

    const updateState = () => {
      setState({
        doc,
        provider,
        awareness: provider.awareness,
        connected: provider.wsconnected,
        synced: provider.synced,
      });
    };

    provider.on("status", updateState);
    provider.on("sync", updateState);
    updateState();

    return () => {
      provider.disconnect();
      provider.destroy();
      doc.destroy();
      setState(null);
    };
  }, [options?.documentName, options?.token, options?.wsUrl]);

  return state;
}
```

- [ ] **Step 3: Create CollaborationProvider React context**

Create `src/components/collab/collaboration-provider.tsx`:

```tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { useYjsProvider } from "@/lib/yjs-provider";
import { setLocalAwareness } from "@/server/collab/awareness";

interface CollaborationContextValue {
  doc: Y.Doc | null;
  awareness: Awareness | null;
  connected: boolean;
  synced: boolean;
}

const CollaborationContext = createContext<CollaborationContextValue>({
  doc: null,
  awareness: null,
  connected: false,
  synced: false,
});

export function useCollaboration() {
  return useContext(CollaborationContext);
}

interface CollaborationProviderProps {
  chainId: string;
  sessionToken: string;
  user: { id: string; name: string };
  children: ReactNode;
}

export function CollaborationProvider({
  chainId,
  sessionToken,
  user,
  children,
}: CollaborationProviderProps) {
  const yjsState = useYjsProvider({
    documentName: `chain:${chainId}`,
    token: sessionToken,
  });

  // Set local awareness when connected
  useEffect(() => {
    if (yjsState?.awareness) {
      setLocalAwareness(yjsState.awareness, user);
    }
  }, [yjsState?.awareness, user]);

  return (
    <CollaborationContext.Provider
      value={{
        doc: yjsState?.doc ?? null,
        awareness: yjsState?.awareness ?? null,
        connected: yjsState?.connected ?? false,
        synced: yjsState?.synced ?? false,
      }}
    >
      {children}
    </CollaborationContext.Provider>
  );
}
```

- [ ] **Step 4: Create online users component**

Create `src/components/collab/online-users.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useCollaboration } from "./collaboration-provider";
import {
  getRemoteUsers,
  type UserAwareness,
} from "@/server/collab/awareness";

export function OnlineUsers() {
  const { awareness, connected } = useCollaboration();
  const [users, setUsers] = useState<UserAwareness[]>([]);

  useEffect(() => {
    if (!awareness) return;

    const updateUsers = () => {
      setUsers(getRemoteUsers(awareness));
    };

    awareness.on("change", updateUsers);
    updateUsers();

    return () => {
      awareness.off("change", updateUsers);
    };
  }, [awareness]);

  if (!connected) return null;

  return (
    <div className="flex items-center gap-1">
      {/* Connection indicator */}
      <div className="mr-2 flex items-center gap-1">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        <span className="text-xs text-gray-500">在线</span>
      </div>

      {/* User avatars */}
      <div className="flex -space-x-2">
        {users.map((user) => (
          <div
            key={user.userId}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-medium text-white"
            style={{ backgroundColor: user.userColor }}
            title={user.userName}
          >
            {user.userName?.charAt(0)?.toUpperCase() ?? "?"}
          </div>
        ))}
      </div>

      {users.length > 0 && (
        <span className="ml-1 text-xs text-gray-400">
          {users.length} 人协作中
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create cursor overlay component**

Create `src/components/collab/cursor-overlay.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useCollaboration } from "./collaboration-provider";
import {
  getRemoteUsers,
  type UserAwareness,
} from "@/server/collab/awareness";

interface CursorOverlayProps {
  /** Map from nodeId to {x,y} position in SVG coordinates */
  nodePositions: Map<string, { x: number; y: number }>;
}

/**
 * Renders colored selection indicators on nodes that other users have selected.
 */
export function CursorOverlay({ nodePositions }: CursorOverlayProps) {
  const { awareness } = useCollaboration();
  const [remoteUsers, setRemoteUsers] = useState<UserAwareness[]>([]);

  useEffect(() => {
    if (!awareness) return;

    const update = () => setRemoteUsers(getRemoteUsers(awareness));
    awareness.on("change", update);
    update();

    return () => {
      awareness.off("change", update);
    };
  }, [awareness]);

  return (
    <>
      {remoteUsers.map((user) => {
        if (!user.selectedNodeId) return null;
        const pos = nodePositions.get(user.selectedNodeId);
        if (!pos) return null;

        return (
          <g key={user.userId} transform={`translate(${pos.x}, ${pos.y})`}>
            {/* Highlight ring around the selected node */}
            <rect
              x={-95}
              y={-40}
              width={190}
              height={80}
              rx={12}
              fill="none"
              stroke={user.userColor}
              strokeWidth={2.5}
              strokeDasharray="6 3"
              opacity={0.7}
            />
            {/* User label */}
            <g transform="translate(95, -40)">
              <rect
                x={-4}
                y={-8}
                width={user.userName.length * 8 + 12}
                height={16}
                rx={4}
                fill={user.userColor}
              />
              <text
                x={2}
                fontSize="10"
                fill="white"
                fontWeight="500"
                dominantBaseline="middle"
              >
                {user.userName}
              </text>
            </g>
          </g>
        );
      })}
    </>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/yjs-provider.ts src/server/collab/awareness.ts src/components/collab/
git commit -m "feat: add collaboration provider with awareness, online users, and cursor overlay"
```

---

### Task 5: Comments System

**Files:**
- Create: `src/server/trpc/routers/comment.ts`
- Modify: `src/server/trpc/router.ts`
- Create: `src/components/comments/comment-thread.tsx`
- Create: `src/components/comments/comment-input.tsx`
- Create: `src/components/comments/comment-sidebar.tsx`
- Create: `tests/server/collab/comment.test.ts`

- [ ] **Step 1: Write failing tests for comments**

Create `tests/server/collab/comment.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/server/collab/comment.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement comment service and router**

Create `src/server/trpc/routers/comment.ts`:

```typescript
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, teamProcedure } from "../init";
import { db } from "../../db";

export async function createComment(data: {
  chainId: string;
  targetType: "NODE" | "COMPANY";
  targetId: string;
  userId: string;
  content: string;
}) {
  return db.comment.create({
    data: {
      chainId: data.chainId,
      targetType: data.targetType,
      targetId: data.targetId,
      userId: data.userId,
      content: data.content,
    },
    include: {
      user: { select: { id: true, name: true, image: true } },
    },
  });
}

export async function listComments(chainId: string, targetId: string) {
  return db.comment.findMany({
    where: { chainId, targetId },
    include: {
      user: { select: { id: true, name: true, image: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function deleteComment(commentId: string, userId: string) {
  const comment = await db.comment.findUnique({ where: { id: commentId } });

  if (!comment) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  if (comment.userId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only delete your own comments",
    });
  }

  return db.comment.delete({ where: { id: commentId } });
}

export const commentRouter = createRouter({
  create: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        chainId: z.string(),
        targetType: z.enum(["NODE", "COMPANY"]),
        targetId: z.string(),
        content: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createComment({
        chainId: input.chainId,
        targetType: input.targetType,
        targetId: input.targetId,
        userId: ctx.userId,
        content: input.content,
      });
    }),

  list: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        chainId: z.string(),
        targetId: z.string(),
      })
    )
    .query(async ({ input }) => {
      return listComments(input.chainId, input.targetId);
    }),

  delete: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        commentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return deleteComment(input.commentId, ctx.userId);
    }),
});
```

- [ ] **Step 4: Register comment router**

Update `src/server/trpc/router.ts`:

```typescript
import { createRouter } from "./init";
import { authRouter } from "./routers/auth";
import { teamRouter } from "./routers/team";
import { projectRouter } from "./routers/project";
import { generationRouter } from "./routers/generation";
import { commentRouter } from "./routers/comment";

export const appRouter = createRouter({
  auth: authRouter,
  team: teamRouter,
  project: projectRouter,
  generation: generationRouter,
  comment: commentRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Create comment UI components**

Create `src/components/comments/comment-input.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CommentInputProps {
  onSubmit: (content: string) => void;
  loading?: boolean;
}

export function CommentInput({ onSubmit, loading }: CommentInputProps) {
  const [content, setContent] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    onSubmit(content.trim());
    setContent("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="添加评论..."
        disabled={loading}
        className="flex-1"
      />
      <Button type="submit" size="sm" disabled={!content.trim() || loading}>
        发送
      </Button>
    </form>
  );
}
```

Create `src/components/comments/comment-thread.tsx`:

```tsx
"use client";

import { trpc } from "@/lib/trpc";
import { CommentInput } from "./comment-input";

interface CommentThreadProps {
  teamId: string;
  chainId: string;
  targetType: "NODE" | "COMPANY";
  targetId: string;
  currentUserId: string;
}

export function CommentThread({
  teamId,
  chainId,
  targetType,
  targetId,
  currentUserId,
}: CommentThreadProps) {
  const { data: comments, refetch } = trpc.comment.list.useQuery({
    teamId,
    chainId,
    targetId,
  });

  const createComment = trpc.comment.create.useMutation({
    onSuccess: () => refetch(),
  });

  const deleteComment = trpc.comment.delete.useMutation({
    onSuccess: () => refetch(),
  });

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700">
        评论 ({comments?.length ?? 0})
      </h4>

      {/* Comments list */}
      <div className="space-y-2">
        {comments?.map((comment) => (
          <div
            key={comment.id}
            className="rounded-lg bg-gray-50 px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">
                {comment.user.name ?? "匿名"}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">
                  {new Date(comment.createdAt).toLocaleString("zh-CN")}
                </span>
                {comment.userId === currentUserId && (
                  <button
                    className="text-xs text-red-400 hover:text-red-600"
                    onClick={() =>
                      deleteComment.mutate({
                        teamId,
                        commentId: comment.id,
                      })
                    }
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm text-gray-600">{comment.content}</p>
          </div>
        ))}
      </div>

      {/* New comment input */}
      <CommentInput
        onSubmit={(content) =>
          createComment.mutate({
            teamId,
            chainId,
            targetType,
            targetId,
            content,
          })
        }
        loading={createComment.isPending}
      />
    </div>
  );
}
```

Create `src/components/comments/comment-sidebar.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { CommentThread } from "./comment-thread";

interface CommentSidebarProps {
  teamId: string;
  chainId: string;
  targetType: "NODE" | "COMPANY";
  targetId: string;
  targetName: string;
  currentUserId: string;
  onClose: () => void;
}

export function CommentSidebar({
  teamId,
  chainId,
  targetType,
  targetId,
  targetName,
  currentUserId,
  onClose,
}: CommentSidebarProps) {
  return (
    <div className="w-80 overflow-y-auto border-l border-gray-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">评论</h3>
          <p className="text-xs text-gray-500">{targetName}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          ✕
        </Button>
      </div>

      <CommentThread
        teamId={teamId}
        chainId={chainId}
        targetType={targetType}
        targetId={targetId}
        currentUserId={currentUserId}
      />
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

```bash
npm test -- tests/server/collab/comment.test.ts
```

Expected: All 3 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/trpc/routers/comment.ts src/server/trpc/router.ts src/components/comments/ tests/server/collab/comment.test.ts
git commit -m "feat: add inline comments system with tRPC router and UI components"
```

---

### Task 6: Undo/Redo Support

**Files:**
- Create: `src/hooks/use-undo-manager.ts`
- Create: `src/components/collab/undo-redo-toolbar.tsx`

- [ ] **Step 1: Create undo manager hook**

Create `src/hooks/use-undo-manager.ts`:

```typescript
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { useCollaboration } from "@/components/collab/collaboration-provider";

interface UndoManagerState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/**
 * Hook that provides undo/redo functionality for Yjs shared types.
 * Wraps Y.UndoManager and tracks the user's origin for proper attribution.
 */
export function useUndoManager(): UndoManagerState {
  const { doc } = useCollaboration();
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (!doc) return;

    const chainNodes = doc.getMap("chainNodes");
    const annotations = doc.getMap("annotations");

    const undoManager = new Y.UndoManager([chainNodes, annotations], {
      captureTimeout: 500, // Group rapid changes within 500ms
    });

    undoManagerRef.current = undoManager;

    const updateState = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };

    undoManager.on("stack-item-added", updateState);
    undoManager.on("stack-item-popped", updateState);
    updateState();

    return () => {
      undoManager.destroy();
      undoManagerRef.current = null;
    };
  }, [doc]);

  const undo = useCallback(() => {
    undoManagerRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoManagerRef.current?.redo();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (isMod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      if (isMod && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  return { canUndo, canRedo, undo, redo };
}
```

- [ ] **Step 2: Create undo/redo toolbar component**

Create `src/components/collab/undo-redo-toolbar.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { useUndoManager } from "@/hooks/use-undo-manager";

export function UndoRedoToolbar() {
  const { canUndo, canRedo, undo, redo } = useUndoManager();

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={undo}
        disabled={!canUndo}
        title="撤销 (Ctrl+Z)"
      >
        撤销
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={redo}
        disabled={!canRedo}
        title="重做 (Ctrl+Shift+Z)"
      >
        重做
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-undo-manager.ts src/components/collab/undo-redo-toolbar.tsx
git commit -m "feat: add undo/redo support with Y.UndoManager and keyboard shortcuts"
```

---

### Task 7: Run All Tests and Final Verification

- [ ] **Step 1: Run Prisma migration (if not already done)**

```bash
npx prisma migrate dev --name add-collab-models
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests pass (17 existing + Yjs schema tests + sync tests + comment tests)

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
npm test && npm run build
```

---

## Phase 4 Complete

After completing all 7 tasks, you have:

- Yjs + Hocuspocus installed with custom Next.js server
- WebSocket endpoint at `/collab` for real-time document sync
- Yjs document schema with `chainNodes` (Y.Map), `annotations` (Y.Map), `comments` (Y.Array)
- Bidirectional Yjs <-> Prisma sync with debounced writes
- Authentication on WebSocket connections (session token validation)
- Awareness protocol: online user list, selected node indicators, user colors
- CollaborationProvider React context for easy access to Yjs doc + awareness
- Inline comments system: create, list, delete with tRPC + UI components
- Undo/redo support with Y.UndoManager + keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z)
- Comment and CollabDocument Prisma models with proper relations

**The full Atlas platform is now feature-complete across all 4 phases:**
1. Foundation (auth, teams, projects, database)
2. AI Generation Pipeline (LLM router, 5-step chain generation)
3. Tree Visualization (D3.js interactive tree, company panel, search)
4. Real-time Collaboration (Yjs sync, awareness, comments, undo/redo)
