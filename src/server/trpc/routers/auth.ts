import { z } from "zod";
import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { createRouter, publicProcedure } from "../init";
import { db } from "../../db";

export async function registerUser(input: {
  username?: string;
  email: string;
  password: string;
  name: string;
}) {
  const existing = await db.user.findUnique({
    where: { email: input.email },
  });

  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "该邮箱已注册",
    });
  }

  if (input.username) {
    const existingUsername = await db.user.findUnique({
      where: { username: input.username },
    });
    if (existingUsername) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "该用户名已被使用",
      });
    }
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const user = await db.user.create({
    data: {
      username: input.username || null,
      email: input.email,
      name: input.name,
      passwordHash,
    },
  });

  // Create a default team for the new user
  await db.team.create({
    data: {
      name: `${input.name}'s Team`,
      members: {
        create: {
          userId: user.id,
          role: "OWNER",
        },
      },
    },
  });

  return { user };
}

export const authRouter = createRouter({
  register: publicProcedure
    .input(
      z.object({
        username: z.string().min(2).max(30).regex(/^[a-zA-Z0-9_-]+$/, "用户名只能包含字母、数字、下划线和连字符").optional(),
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const result = await registerUser(input);
      return { userId: result.user.id };
    }),
});
