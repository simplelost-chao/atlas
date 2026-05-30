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
