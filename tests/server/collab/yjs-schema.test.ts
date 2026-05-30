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
