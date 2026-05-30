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
