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
