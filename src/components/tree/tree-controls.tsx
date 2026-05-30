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
    <div className="absolute bottom-4 right-4 flex flex-col gap-1.5">
      <Button
        variant="outline"
        size="icon"
        onClick={onZoomIn}
        title="放大"
        className="h-10 w-10 md:h-8 md:w-8 bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      >
        <span className="text-lg">+</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onZoomOut}
        title="缩小"
        className="h-10 w-10 md:h-8 md:w-8 bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      >
        <span className="text-lg">-</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onFitToScreen}
        title="适应屏幕"
        className="h-10 w-10 md:h-8 md:w-8 bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      >
        <span className="text-xs">FIT</span>
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onResetZoom}
        title="重置缩放"
        className="h-10 w-10 md:h-8 md:w-8 bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      >
        <span className="text-xs">1:1</span>
      </Button>
    </div>
  );
}
