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
