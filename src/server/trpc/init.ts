import { initTRPC, TRPCError } from "@trpc/server";
import { getServerSession } from "next-auth";
import superjson from "superjson";
import { z, ZodError } from "zod";
import { authOptions } from "../auth";
import { db } from "../db";

export const createTRPCContext = async () => {
  const session = await getServerSession(authOptions);

  return {
    db,
    session,
    userId: session?.user?.id,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session || !ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      session: ctx.session,
      userId: ctx.userId,
    },
  });
});

export const teamProcedure = protectedProcedure
  .input(z.object({ teamId: z.string() }))
  .use(async ({ ctx, input, next }) => {
    const member = await ctx.db.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: input.teamId,
          userId: ctx.userId,
        },
      },
    });

    if (!member) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You are not a member of this team",
      });
    }

    return next({
      ctx: {
        ...ctx,
        teamId: input.teamId,
        teamRole: member.role,
      },
    });
  });
