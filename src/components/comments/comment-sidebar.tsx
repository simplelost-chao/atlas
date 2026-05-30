"use client";

import { Button } from "@/components/ui/button";
import { CommentThread } from "./comment-thread";

interface CommentSidebarProps {
  teamId: string;
  chainId: string;
  targetType: "NODE" | "COMPANY";
  targetId: string;
  targetName: string;
  currentUserId: string;
  onClose: () => void;
}

export function CommentSidebar({
  teamId,
  chainId,
  targetType,
  targetId,
  targetName,
  currentUserId,
  onClose,
}: CommentSidebarProps) {
  return (
    <div className="w-80 overflow-y-auto border-l border-gray-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">评论</h3>
          <p className="text-xs text-gray-500">{targetName}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          ✕
        </Button>
      </div>

      <CommentThread
        teamId={teamId}
        chainId={chainId}
        targetType={targetType}
        targetId={targetId}
        currentUserId={currentUserId}
      />
    </div>
  );
}
