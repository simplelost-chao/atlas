"use client";

import { useEffect, useRef } from "react";

interface ContextMenuItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface NodeContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function NodeContextMenu({
  x,
  y,
  items,
  onClose,
}: NodeContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] rounded-md border border-gray-200 bg-white py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
            item.disabled
              ? "cursor-not-allowed text-gray-300"
              : item.destructive
                ? "text-red-600 hover:bg-red-50"
                : "text-gray-700 hover:bg-gray-50"
          }`}
          onClick={() => {
            if (!item.disabled) {
              item.onClick();
              onClose();
            }
          }}
          disabled={item.disabled}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
