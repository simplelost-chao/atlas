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
