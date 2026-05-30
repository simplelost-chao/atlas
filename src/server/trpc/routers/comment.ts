import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, teamProcedure } from "../init";
import { db } from "../../db";

export async function createComment(data: {
  chainId: string;
  targetType: "NODE" | "COMPANY";
  targetId: string;
  userId: string;
  content: string;
}) {
  return db.comment.create({
    data: {
      chainId: data.chainId,
      targetType: data.targetType,
      targetId: data.targetId,
      userId: data.userId,
      content: data.content,
    },
    include: {
      user: { select: { id: true, name: true, image: true } },
    },
  });
}

export async function listComments(chainId: string, targetId: string) {
  return db.comment.findMany({
    where: { chainId, targetId },
    include: {
      user: { select: { id: true, name: true, image: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function deleteComment(commentId: string, userId: string) {
  const comment = await db.comment.findUnique({ where: { id: commentId } });

  if (!comment) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  if (comment.userId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only delete your own comments",
    });
  }

  return db.comment.delete({ where: { id: commentId } });
}

export const commentRouter = createRouter({
  create: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        chainId: z.string(),
        targetType: z.enum(["NODE", "COMPANY"]),
        targetId: z.string(),
        content: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createComment({
        chainId: input.chainId,
        targetType: input.targetType,
        targetId: input.targetId,
        userId: ctx.userId,
        content: input.content,
      });
    }),

  list: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        chainId: z.string(),
        targetId: z.string(),
      })
    )
    .query(async ({ input }) => {
      return listComments(input.chainId, input.targetId);
    }),

  delete: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        commentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return deleteComment(input.commentId, ctx.userId);
    }),
});
