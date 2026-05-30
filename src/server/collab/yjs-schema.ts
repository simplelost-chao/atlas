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
