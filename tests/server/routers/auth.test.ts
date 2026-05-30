import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import bcrypt from "bcryptjs";
import { registerUser } from "@/server/trpc/routers/auth";

describe("registerUser", () => {
  it("creates a user with hashed password and a default team", async () => {
    const result = await registerUser({
      email: "new@example.com",
      password: "securepass123",
      name: "New User",
    });

    expect(result.user.email).toBe("new@example.com");
    expect(result.user.name).toBe("New User");
    expect(result.user.passwordHash).not.toBe("securepass123");

    // Password should be hashed
    const isValid = await bcrypt.compare(
      "securepass123",
      result.user.passwordHash!
    );
    expect(isValid).toBe(true);

    // Should create a default team with user as OWNER
    const membership = await db.teamMember.findFirst({
      where: { userId: result.user.id },
      include: { team: true },
    });
    expect(membership).not.toBeNull();
    expect(membership!.role).toBe("OWNER");
    expect(membership!.team.name).toBe("New User's Team");
  });

  it("rejects duplicate emails", async () => {
    await registerUser({
      email: "dup@example.com",
      password: "pass123",
      name: "First",
    });

    await expect(
      registerUser({
        email: "dup@example.com",
        password: "pass456",
        name: "Second",
      })
    ).rejects.toThrow("Email already registered");
  });
});
