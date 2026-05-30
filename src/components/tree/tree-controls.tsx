"use client";

import { Button } from "@/components/ui/button";

interface TreeControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitToScreen: () => void;
}

export function TreeControls({
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitToScreen,
}: TreeControlsProps) {
  return (
    <div className="absolute bottom-4 right-4 flex flex-col gap-1">
      <Button variant="outline" size="icon" onClick={onZoomIn} title="放大">
        <span className="text-lg">+</span>
      </Button>
      <Button variant="outline" size="icon" onClick={onZoomOut} title="缩小">
        <span className="text-lg">-</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onFitToScreen}
        title="适应屏幕"
      >
        <span className="text-xs">FIT</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onResetZoom}
        title="重置缩放"
      >
        <span className="text-xs">1:1</span>
      </Button>
    </div>
  );
}
