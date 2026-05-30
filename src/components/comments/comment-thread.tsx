"use client";

import { trpc } from "@/lib/trpc";
import { CommentInput } from "./comment-input";

interface CommentThreadProps {
  teamId: string;
  chainId: string;
  targetType: "NODE" | "COMPANY";
  targetId: string;
  currentUserId: string;
}

export function CommentThread({
  teamId,
  chainId,
  targetType,
  targetId,
  currentUserId,
}: CommentThreadProps) {
  const { data: comments, refetch } = trpc.comment.list.useQuery({
    teamId,
    chainId,
    targetId,
  });

  const createComment = trpc.comment.create.useMutation({
    onSuccess: () => refetch(),
  });

  const deleteComment = trpc.comment.delete.useMutation({
    onSuccess: () => refetch(),
  });

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700">
        评论 ({comments?.length ?? 0})
      </h4>

      {/* Comments list */}
      <div className="space-y-2">
        {comments?.map((comment) => (
          <div
            key={comment.id}
            className="rounded-lg bg-gray-50 px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">
                {comment.user.name ?? "匿名"}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">
                  {new Date(comment.createdAt).toLocaleString("zh-CN")}
                </span>
                {comment.userId === currentUserId && (
                  <button
                    className="text-xs text-red-400 hover:text-red-600"
                    onClick={() =>
                      deleteComment.mutate({
                        teamId,
                        commentId: comment.id,
                      })
                    }
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm text-gray-600">{comment.content}</p>
          </div>
        ))}
      </div>

      {/* New comment input */}
      <CommentInput
        onSubmit={(content) =>
          createComment.mutate({
            teamId,
            chainId,
            targetType,
            targetId,
            content,
          })
        }
        loading={createComment.isPending}
      />
    </div>
  );
}
