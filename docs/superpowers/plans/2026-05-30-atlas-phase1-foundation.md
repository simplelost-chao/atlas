# Atlas Phase 1: Foundation (Setup + Database + Auth + Team) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the Next.js project with database, authentication, team management, and project CRUD — the foundation all other features build on.

**Architecture:** Next.js 15 App Router monolith with tRPC for type-safe APIs, Prisma ORM for PostgreSQL, and NextAuth.js for authentication. All data is team-scoped.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS, tRPC, Prisma, PostgreSQL, NextAuth.js

---

## File Structure

```
atlas/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── .env.example
├── .env.local                    (gitignored)
├── prisma/
│   ├── schema.prisma             (all models)
│   └── seed.ts                   (dev seed data)
├── src/
│   ├── app/
│   │   ├── layout.tsx            (root layout)
│   │   ├── page.tsx              (landing page)
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   ├── invite/[token]/page.tsx
│   │   ├── (app)/
│   │   │   ├── layout.tsx        (authenticated layout with sidebar)
│   │   │   ├── page.tsx          (dashboard redirect)
│   │   │   ├── projects/
│   │   │   │   ├── page.tsx      (project list)
│   │   │   │   └── new/page.tsx  (create project)
│   │   │   ├── team/page.tsx     (team management)
│   │   │   └── settings/page.tsx (settings)
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       └── trpc/[trpc]/route.ts
│   ├── server/
│   │   ├── db.ts                 (Prisma client singleton)
│   │   ├── auth.ts               (NextAuth config)
│   │   ├── trpc/
│   │   │   ├── init.ts           (tRPC initialization + context)
│   │   │   ├── router.ts         (root router)
│   │   │   └── routers/
│   │   │       ├── team.ts       (team CRUD + invite)
│   │   │       └── project.ts    (project CRUD)
│   │   └── services/
│   │       └── invite.ts         (invite token generation/validation)
│   ├── lib/
│   │   ├── trpc.ts               (tRPC client hooks)
│   │   └── utils.ts              (cn helper, shared utils)
│   └── components/
│       ├── providers.tsx          (SessionProvider + tRPC provider)
│       ├── sidebar.tsx
│       ├── team-switcher.tsx
│       └── ui/                    (basic UI components)
│           ├── button.tsx
│           ├── input.tsx
│           ├── card.tsx
│           └── dialog.tsx
├── tests/
│   ├── setup.ts                   (test setup, Prisma test client)
│   ├── helpers.ts                 (factory functions)
│   ├── server/
│   │   ├── routers/
│   │   │   ├── team.test.ts
│   │   │   └── project.test.ts
│   │   └── services/
│   │       └── invite.test.ts
│   └── e2e/                       (placeholder for future)
└── docs/
```

---

### Task 1: Next.js Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.env.example`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `src/lib/utils.ts`

- [ ] **Step 1: Initialize Next.js project**

```bash
cd /Users/chao/Documents/Projects/atlas
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
```

When prompted about overwriting existing files, answer yes. The existing `favicon.svg` and `logo.svg` should be preserved.

- [ ] **Step 2: Verify the app starts**

```bash
npm run dev
```

Expected: App starts on http://localhost:3000, shows default Next.js page.
Kill the dev server after verifying.

- [ ] **Step 3: Create `.env.example`**

```bash
# .env.example
DATABASE_URL="postgresql://user:password@localhost:5432/atlas"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"

# OAuth (optional)
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

- [ ] **Step 4: Add utility function**

Create `src/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

```bash
npm install clsx tailwind-merge
```

- [ ] **Step 5: Clean up default page**

Replace `src/app/page.tsx` with a minimal landing page:

```tsx
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">Atlas</h1>
      <p className="mt-4 text-lg text-gray-600">
        产业链分析与投资标的挖掘平台
      </p>
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js 15 project with Tailwind CSS"
```

---

### Task 2: Prisma + Database Schema

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/server/db.ts`

- [ ] **Step 1: Install Prisma**

```bash
npm install prisma --save-dev
npm install @prisma/client
npx prisma init
```

- [ ] **Step 2: Write the full schema**

Replace `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Auth ───────────────────────────────────────

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  passwordHash  String?
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts    Account[]
  sessions    Session[]
  teamMembers TeamMember[]
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// ─── Team ───────────────────────────────────────

enum TeamRole {
  OWNER
  ADMIN
  EDITOR
  VIEWER
}

model Team {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members   TeamMember[]
  projects  Project[]
  apiKeys   ApiKey[]
  invites   TeamInvite[]
}

model TeamMember {
  id     String   @id @default(cuid())
  role   TeamRole @default(EDITOR)
  teamId String
  userId String

  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([teamId, userId])
}

model TeamInvite {
  id        String   @id @default(cuid())
  teamId    String
  email     String
  role      TeamRole @default(EDITOR)
  token     String   @unique @default(cuid())
  expiresAt DateTime
  createdAt DateTime @default(now())

  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@index([token])
}

model ApiKey {
  id             String @id @default(cuid())
  teamId         String
  provider       String   // "anthropic", "openai", etc.
  encryptedKey   String
  label          String?
  createdAt      DateTime @default(now())

  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@unique([teamId, provider])
}

// ─── Project & Industry Chain ───────────────────

model Project {
  id          String   @id @default(cuid())
  teamId      String
  name        String
  description String?
  industry    String   // the keyword used to generate
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  team  Team           @relation(fields: [teamId], references: [id], onDelete: Cascade)
  chain IndustryChain?
}

model IndustryChain {
  id        String   @id @default(cuid())
  projectId String   @unique
  status    ChainStatus @default(PENDING)
  maxDepth  Int      @default(4)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  project Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  nodes   ChainNode[]
}

enum ChainStatus {
  PENDING
  GENERATING
  COMPLETED
  FAILED
}

enum NodeType {
  UPSTREAM
  MIDSTREAM
  DOWNSTREAM
}

model ChainNode {
  id           String   @id @default(cuid())
  chainId      String
  parentId     String?
  name         String
  description  String   @default("")
  nodeType     NodeType
  level        Int      @default(0)
  order        Int      @default(0)
  profitMargin String?
  marketSize   String?
  growthTrend  String?
  keyDrivers   String[] @default([])
  valueFlow    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  chain     IndustryChain @relation(fields: [chainId], references: [id], onDelete: Cascade)
  parent    ChainNode?    @relation("NodeTree", fields: [parentId], references: [id])
  children  ChainNode[]   @relation("NodeTree")
  companies Company[]
}

enum MarketPosition {
  LEADER
  CHALLENGER
  EMERGING
  NICHE
}

model Company {
  id          String @id @default(cuid())
  chainNodeId String

  // Basic
  name         String
  ticker       String?
  exchange     String?
  isPublic     Boolean @default(false)
  country      String?
  mainBusiness String  @default("")
  coreProducts String[] @default([])

  // Financials
  marketCap      String?
  revenue        String?
  revenueGrowth  String?
  grossMargin    String?
  netMargin      String?
  roe            String?
  financialTrend Json?

  // Competitive
  marketPosition MarketPosition @default(EMERGING)
  marketShare    String?
  moat           String?
  competitors    String[] @default([])

  // Investment
  highlights              String[] @default([])
  risks                   String[] @default([])
  analystRating           String?
  customerConcentration   String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  chainNode          ChainNode       @relation(fields: [chainNodeId], references: [id], onDelete: Cascade)
  supplierRelations  SupplyRelation[] @relation("Supplier")
  customerRelations  SupplyRelation[] @relation("Customer")
}

enum RelationType {
  SUPPLIER
  CUSTOMER
  PARTNER
}

model SupplyRelation {
  id           String       @id @default(cuid())
  supplierId   String
  customerId   String
  relationType RelationType
  description  String?
  createdAt    DateTime     @default(now())

  supplier Company @relation("Supplier", fields: [supplierId], references: [id], onDelete: Cascade)
  customer Company @relation("Customer", fields: [customerId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 3: Create Prisma client singleton**

Create `src/server/db.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

- [ ] **Step 4: Set up `.env.local` and run migration**

Create `.env.local` with your actual PostgreSQL connection string, then:

```bash
npx prisma migrate dev --name init
```

Expected: Migration created and applied. All tables created in PostgreSQL.

- [ ] **Step 5: Verify with Prisma Studio**

```bash
npx prisma studio
```

Expected: Opens browser showing all tables (User, Team, TeamMember, Project, IndustryChain, ChainNode, Company, SupplyRelation, etc.)

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/server/db.ts
git commit -m "feat: add Prisma schema with all data models"
```

---

### Task 3: NextAuth.js Authentication

**Files:**
- Create: `src/server/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/components/providers.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Install dependencies**

```bash
npm install next-auth @auth/prisma-adapter bcryptjs
npm install --save-dev @types/bcryptjs
```

- [ ] **Step 2: Create NextAuth config**

Create `src/server/auth.ts`:

```typescript
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { db } from "./db";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user?.passwordHash) return null;

        const isValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isValid) return null;

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
    ...(process.env.GITHUB_CLIENT_ID
      ? [
          GitHubProvider({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET!,
          }),
        ]
      : []),
    ...(process.env.GOOGLE_CLIENT_ID
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
```

- [ ] **Step 3: Create API route**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```typescript
import NextAuth from "next-auth";
import { authOptions } from "@/server/auth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
```

- [ ] **Step 4: Create providers wrapper**

Create `src/components/providers.tsx`:

```tsx
"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

- [ ] **Step 5: Update root layout**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Atlas - 产业链分析平台",
  description: "产业链分析与投资标的挖掘平台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Add NextAuth type augmentation**

Create `src/types/next-auth.d.ts`:

```typescript
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/server/auth.ts src/app/api/auth/ src/components/providers.tsx src/app/layout.tsx src/types/
git commit -m "feat: add NextAuth.js with credentials + OAuth providers"
```

---

### Task 4: tRPC Setup

**Files:**
- Create: `src/server/trpc/init.ts`
- Create: `src/server/trpc/router.ts`
- Create: `src/app/api/trpc/[trpc]/route.ts`
- Create: `src/lib/trpc.ts`
- Modify: `src/components/providers.tsx`

- [ ] **Step 1: Install tRPC**

```bash
npm install @trpc/server @trpc/client @trpc/react-query @trpc/next @tanstack/react-query superjson zod
```

- [ ] **Step 2: Create tRPC initialization**

Create `src/server/trpc/init.ts`:

```typescript
import { initTRPC, TRPCError } from "@trpc/server";
import { getServerSession } from "next-auth";
import superjson from "superjson";
import { ZodError } from "zod";
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

// Middleware: ensures user is a member of the team and injects teamId + role
export const teamProcedure = protectedProcedure
  .input(
    (await import("zod")).z.object({
      teamId: (await import("zod")).z.string(),
    })
  )
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
```

Note: the dynamic `import("zod")` in `teamProcedure` avoids circular issues. Alternatively, import zod at the top. Let me simplify:

Create `src/server/trpc/init.ts` (corrected):

```typescript
import { initTRPC, TRPCError } from "@trpc/server";
import { getServerSession } from "next-auth";
import superjson from "superjson";
import { z } from "zod";
import { ZodError } from "zod";
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
```

- [ ] **Step 3: Create root router (empty for now)**

Create `src/server/trpc/router.ts`:

```typescript
import { createRouter } from "./init";

export const appRouter = createRouter({});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 4: Create API route handler**

Create `src/app/api/trpc/[trpc]/route.ts`:

```typescript
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/init";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: createTRPCContext,
  });

export { handler as GET, handler as POST };
```

- [ ] **Step 5: Create tRPC client hooks**

Create `src/lib/trpc.ts`:

```typescript
"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/trpc/router";

export const trpc = createTRPCReact<AppRouter>();
```

- [ ] **Step 6: Update providers with tRPC**

Replace `src/components/providers.tsx`:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { SessionProvider } from "next-auth/react";
import { useState, type ReactNode } from "react";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <SessionProvider>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </trpc.Provider>
    </SessionProvider>
  );
}
```

- [ ] **Step 7: Verify app still compiles**

```bash
npm run build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/server/trpc/ src/app/api/trpc/ src/lib/trpc.ts src/components/providers.tsx
git commit -m "feat: set up tRPC with context, auth middleware, and React hooks"
```

---

### Task 5: Test Infrastructure

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/helpers.ts`

- [ ] **Step 1: Install test dependencies**

```bash
npm install --save-dev vitest @vitejs/plugin-react dotenv
```

- [ ] **Step 2: Create Vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Create test setup**

Create `tests/setup.ts`:

```typescript
import { beforeEach } from "vitest";
import { db } from "@/server/db";

beforeEach(async () => {
  // Clean all tables before each test (order matters for FK constraints)
  await db.supplyRelation.deleteMany();
  await db.company.deleteMany();
  await db.chainNode.deleteMany();
  await db.industryChain.deleteMany();
  await db.project.deleteMany();
  await db.teamInvite.deleteMany();
  await db.apiKey.deleteMany();
  await db.teamMember.deleteMany();
  await db.team.deleteMany();
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.verificationToken.deleteMany();
  await db.user.deleteMany();
});
```

- [ ] **Step 4: Create test helpers**

Create `tests/helpers.ts`:

```typescript
import { db } from "@/server/db";
import bcrypt from "bcryptjs";
import type { TeamRole } from "@prisma/client";

export async function createTestUser(overrides?: {
  email?: string;
  name?: string;
  password?: string;
}) {
  const email = overrides?.email ?? `test-${Date.now()}@example.com`;
  const password = overrides?.password ?? "password123";

  return db.user.create({
    data: {
      email,
      name: overrides?.name ?? "Test User",
      passwordHash: await bcrypt.hash(password, 10),
    },
  });
}

export async function createTestTeam(ownerId: string, name?: string) {
  const team = await db.team.create({
    data: {
      name: name ?? "Test Team",
      members: {
        create: {
          userId: ownerId,
          role: "OWNER",
        },
      },
    },
  });
  return team;
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole = "EDITOR"
) {
  return db.teamMember.create({
    data: { teamId, userId, role },
  });
}

export async function createTestProject(
  teamId: string,
  overrides?: { name?: string; industry?: string }
) {
  return db.project.create({
    data: {
      teamId,
      name: overrides?.name ?? "Test Project",
      industry: overrides?.industry ?? "AI",
    },
  });
}
```

- [ ] **Step 5: Add test script to package.json**

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts tests/
git commit -m "feat: add Vitest test infrastructure with helpers"
```

---

### Task 6: User Registration API

**Files:**
- Create: `src/server/trpc/routers/auth.ts`
- Modify: `src/server/trpc/router.ts`
- Create: `tests/server/routers/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/routers/auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import bcrypt from "bcryptjs";

// Test the registration service directly (not through tRPC, since
// tRPC auth router uses publicProcedure and we test the logic)
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/server/routers/auth.test.ts
```

Expected: FAIL — cannot find module `@/server/trpc/routers/auth`

- [ ] **Step 3: Implement registration**

Create `src/server/trpc/routers/auth.ts`:

```typescript
import { z } from "zod";
import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { createRouter, publicProcedure } from "../init";
import { db } from "../../db";

export async function registerUser(input: {
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
      message: "Email already registered",
    });
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const user = await db.user.create({
    data: {
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
```

- [ ] **Step 4: Register router**

Replace `src/server/trpc/router.ts`:

```typescript
import { createRouter } from "./init";
import { authRouter } from "./routers/auth";

export const appRouter = createRouter({
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/server/routers/auth.test.ts
```

Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/auth.ts src/server/trpc/router.ts tests/server/routers/auth.test.ts
git commit -m "feat: add user registration with default team creation"
```

---

### Task 7: Team CRUD Router

**Files:**
- Create: `src/server/trpc/routers/team.ts`
- Modify: `src/server/trpc/router.ts`
- Create: `tests/server/routers/team.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/routers/team.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { createTestUser, createTestTeam, addTeamMember } from "../helpers";
import {
  createTeam,
  listUserTeams,
  updateTeam,
  getTeamMembers,
  updateMemberRole,
  removeMember,
} from "@/server/trpc/routers/team";

describe("Team operations", () => {
  describe("createTeam", () => {
    it("creates a team and adds creator as OWNER", async () => {
      const user = await createTestUser();
      const team = await createTeam(user.id, "Research Team");

      expect(team.name).toBe("Research Team");

      const member = await db.teamMember.findUnique({
        where: { teamId_userId: { teamId: team.id, userId: user.id } },
      });
      expect(member!.role).toBe("OWNER");
    });
  });

  describe("listUserTeams", () => {
    it("returns all teams a user belongs to", async () => {
      const user = await createTestUser();
      await createTeam(user.id, "Team A");
      await createTeam(user.id, "Team B");

      const teams = await listUserTeams(user.id);
      expect(teams).toHaveLength(2);
      expect(teams.map((t) => t.name).sort()).toEqual(["Team A", "Team B"]);
    });
  });

  describe("updateTeam", () => {
    it("allows OWNER to rename team", async () => {
      const user = await createTestUser();
      const team = await createTeam(user.id, "Old Name");

      const updated = await updateTeam(team.id, { name: "New Name" });
      expect(updated.name).toBe("New Name");
    });
  });

  describe("getTeamMembers", () => {
    it("returns all members with roles", async () => {
      const owner = await createTestUser({ email: "owner@test.com" });
      const editor = await createTestUser({ email: "editor@test.com" });
      const team = await createTeam(owner.id, "Team");
      await addTeamMember(team.id, editor.id, "EDITOR");

      const members = await getTeamMembers(team.id);
      expect(members).toHaveLength(2);
    });
  });

  describe("updateMemberRole", () => {
    it("changes a member role", async () => {
      const owner = await createTestUser({ email: "owner@test.com" });
      const member = await createTestUser({ email: "member@test.com" });
      const team = await createTeam(owner.id, "Team");
      await addTeamMember(team.id, member.id, "VIEWER");

      await updateMemberRole(team.id, member.id, "EDITOR");

      const updated = await db.teamMember.findUnique({
        where: { teamId_userId: { teamId: team.id, userId: member.id } },
      });
      expect(updated!.role).toBe("EDITOR");
    });
  });

  describe("removeMember", () => {
    it("removes a member from the team", async () => {
      const owner = await createTestUser({ email: "owner@test.com" });
      const member = await createTestUser({ email: "member@test.com" });
      const team = await createTeam(owner.id, "Team");
      await addTeamMember(team.id, member.id, "EDITOR");

      await removeMember(team.id, member.id);

      const check = await db.teamMember.findUnique({
        where: { teamId_userId: { teamId: team.id, userId: member.id } },
      });
      expect(check).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/server/routers/team.test.ts
```

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement team service functions and router**

Create `src/server/trpc/routers/team.ts`:

```typescript
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedProcedure, teamProcedure } from "../init";
import { db } from "../../db";
import type { TeamRole } from "@prisma/client";

export async function createTeam(userId: string, name: string) {
  return db.team.create({
    data: {
      name,
      members: {
        create: {
          userId,
          role: "OWNER",
        },
      },
    },
  });
}

export async function listUserTeams(userId: string) {
  const memberships = await db.teamMember.findMany({
    where: { userId },
    include: {
      team: {
        include: {
          _count: { select: { members: true, projects: true } },
        },
      },
    },
  });

  return memberships.map((m) => ({
    ...m.team,
    role: m.role,
    memberCount: m.team._count.members,
    projectCount: m.team._count.projects,
  }));
}

export async function updateTeam(
  teamId: string,
  data: { name?: string }
) {
  return db.team.update({
    where: { id: teamId },
    data,
  });
}

export async function getTeamMembers(teamId: string) {
  return db.teamMember.findMany({
    where: { teamId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });
}

export async function updateMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole
) {
  return db.teamMember.update({
    where: { teamId_userId: { teamId, userId } },
    data: { role },
  });
}

export async function removeMember(teamId: string, userId: string) {
  return db.teamMember.delete({
    where: { teamId_userId: { teamId, userId } },
  });
}

export const teamRouter = createRouter({
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return createTeam(ctx.userId, input.name);
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    return listUserTeams(ctx.userId);
  }),

  update: teamProcedure
    .input(z.object({ teamId: z.string(), name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole !== "OWNER" && ctx.teamRole !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return updateTeam(input.teamId, { name: input.name });
    }),

  members: teamProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ input }) => {
      return getTeamMembers(input.teamId);
    }),

  updateMemberRole: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        userId: z.string(),
        role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole !== "OWNER") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return updateMemberRole(input.teamId, input.userId, input.role);
    }),

  removeMember: teamProcedure
    .input(z.object({ teamId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole !== "OWNER" && ctx.teamRole !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return removeMember(input.teamId, input.userId);
    }),
});
```

- [ ] **Step 4: Register team router**

Update `src/server/trpc/router.ts`:

```typescript
import { createRouter } from "./init";
import { authRouter } from "./routers/auth";
import { teamRouter } from "./routers/team";

export const appRouter = createRouter({
  auth: authRouter,
  team: teamRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/server/routers/team.test.ts
```

Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/team.ts src/server/trpc/router.ts tests/server/routers/team.test.ts
git commit -m "feat: add team CRUD with role-based access control"
```

---

### Task 8: Team Invite System

**Files:**
- Create: `src/server/services/invite.ts`
- Create: `tests/server/services/invite.test.ts`
- Modify: `src/server/trpc/routers/team.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/services/invite.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { createTestUser, createTestTeam } from "../helpers";
import {
  createInvite,
  acceptInvite,
  listPendingInvites,
} from "@/server/services/invite";

describe("Invite service", () => {
  it("creates an invite with token and expiry", async () => {
    const owner = await createTestUser();
    const team = await createTestTeam(owner.id);

    const invite = await createInvite(team.id, "invited@example.com", "EDITOR");

    expect(invite.token).toBeDefined();
    expect(invite.email).toBe("invited@example.com");
    expect(invite.role).toBe("EDITOR");
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts an invite and adds user to team", async () => {
    const owner = await createTestUser({ email: "owner@test.com" });
    const team = await createTestTeam(owner.id);
    const invite = await createInvite(team.id, "new@test.com", "EDITOR");

    const newUser = await createTestUser({ email: "new@test.com" });
    const membership = await acceptInvite(invite.token, newUser.id);

    expect(membership.teamId).toBe(team.id);
    expect(membership.role).toBe("EDITOR");

    // Invite should be deleted after acceptance
    const deletedInvite = await db.teamInvite.findUnique({
      where: { id: invite.id },
    });
    expect(deletedInvite).toBeNull();
  });

  it("rejects expired invites", async () => {
    const owner = await createTestUser();
    const team = await createTestTeam(owner.id);

    // Create an already-expired invite
    const invite = await db.teamInvite.create({
      data: {
        teamId: team.id,
        email: "late@test.com",
        role: "EDITOR",
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      },
    });

    const user = await createTestUser({ email: "late@test.com" });
    await expect(acceptInvite(invite.token, user.id)).rejects.toThrow(
      "Invite has expired"
    );
  });

  it("lists pending invites for a team", async () => {
    const owner = await createTestUser();
    const team = await createTestTeam(owner.id);
    await createInvite(team.id, "a@test.com", "EDITOR");
    await createInvite(team.id, "b@test.com", "VIEWER");

    const invites = await listPendingInvites(team.id);
    expect(invites).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/server/services/invite.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement invite service**

Create `src/server/services/invite.ts`:

```typescript
import { TRPCError } from "@trpc/server";
import { db } from "../db";
import type { TeamRole } from "@prisma/client";

const INVITE_EXPIRY_DAYS = 7;

export async function createInvite(
  teamId: string,
  email: string,
  role: TeamRole
) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  return db.teamInvite.create({
    data: {
      teamId,
      email,
      role,
      expiresAt,
    },
  });
}

export async function acceptInvite(token: string, userId: string) {
  const invite = await db.teamInvite.findUnique({
    where: { token },
  });

  if (!invite) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
  }

  if (invite.expiresAt < new Date()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invite has expired",
    });
  }

  // Add user to team and delete invite in a transaction
  const membership = await db.$transaction(async (tx) => {
    const member = await tx.teamMember.upsert({
      where: {
        teamId_userId: { teamId: invite.teamId, userId },
      },
      update: { role: invite.role },
      create: {
        teamId: invite.teamId,
        userId,
        role: invite.role,
      },
    });

    await tx.teamInvite.delete({ where: { id: invite.id } });

    return member;
  });

  return membership;
}

export async function listPendingInvites(teamId: string) {
  return db.teamInvite.findMany({
    where: {
      teamId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
}
```

- [ ] **Step 4: Add invite endpoints to team router**

Add to the bottom of `src/server/trpc/routers/team.ts`, inside the `createRouter({})` call, add these procedures:

```typescript
  invite: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        email: z.string().email(),
        role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole !== "OWNER" && ctx.teamRole !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const { createInvite } = await import("../../services/invite");
      return createInvite(input.teamId, input.email, input.role);
    }),

  pendingInvites: teamProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ input }) => {
      const { listPendingInvites } = await import("../../services/invite");
      return listPendingInvites(input.teamId);
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { acceptInvite } = await import("../../services/invite");
      return acceptInvite(input.token, ctx.userId);
    }),
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/server/services/invite.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/services/invite.ts src/server/trpc/routers/team.ts tests/server/services/invite.test.ts
git commit -m "feat: add team invite system with token-based acceptance"
```

---

### Task 9: Project CRUD Router

**Files:**
- Create: `src/server/trpc/routers/project.ts`
- Modify: `src/server/trpc/router.ts`
- Create: `tests/server/routers/project.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/routers/project.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { createTestUser, createTestTeam } from "../helpers";
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from "@/server/trpc/routers/project";

describe("Project operations", () => {
  it("creates a project with industry keyword", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);

    const project = await createProject(team.id, {
      name: "AI Investment Research",
      industry: "AI",
      description: "Mapping the AI supply chain",
    });

    expect(project.name).toBe("AI Investment Research");
    expect(project.industry).toBe("AI");
    expect(project.teamId).toBe(team.id);
  });

  it("lists projects for a team", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    await createProject(team.id, { name: "AI", industry: "AI" });
    await createProject(team.id, { name: "Semiconductor", industry: "半导体" });

    const projects = await listProjects(team.id);
    expect(projects).toHaveLength(2);
  });

  it("gets a project by id with chain status", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createProject(team.id, {
      name: "AI",
      industry: "AI",
    });

    const found = await getProject(project.id, team.id);
    expect(found!.name).toBe("AI");
    expect(found!.chain).toBeNull(); // No chain generated yet
  });

  it("updates a project", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createProject(team.id, {
      name: "AI",
      industry: "AI",
    });

    const updated = await updateProject(project.id, team.id, {
      name: "AI Research v2",
    });
    expect(updated.name).toBe("AI Research v2");
  });

  it("deletes a project", async () => {
    const user = await createTestUser();
    const team = await createTestTeam(user.id);
    const project = await createProject(team.id, {
      name: "AI",
      industry: "AI",
    });

    await deleteProject(project.id, team.id);

    const found = await db.project.findUnique({
      where: { id: project.id },
    });
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/server/routers/project.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement project service and router**

Create `src/server/trpc/routers/project.ts`:

```typescript
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, teamProcedure } from "../init";
import { db } from "../../db";

export async function createProject(
  teamId: string,
  data: { name: string; industry: string; description?: string }
) {
  return db.project.create({
    data: {
      teamId,
      name: data.name,
      industry: data.industry,
      description: data.description,
    },
  });
}

export async function listProjects(teamId: string) {
  return db.project.findMany({
    where: { teamId },
    include: {
      chain: { select: { id: true, status: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getProject(projectId: string, teamId: string) {
  return db.project.findFirst({
    where: { id: projectId, teamId },
    include: {
      chain: {
        select: { id: true, status: true, maxDepth: true },
      },
    },
  });
}

export async function updateProject(
  projectId: string,
  teamId: string,
  data: { name?: string; description?: string }
) {
  const project = await db.project.findFirst({
    where: { id: projectId, teamId },
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  return db.project.update({
    where: { id: projectId },
    data,
  });
}

export async function deleteProject(projectId: string, teamId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, teamId },
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  return db.project.delete({ where: { id: projectId } });
}

export const projectRouter = createRouter({
  create: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        name: z.string().min(1).max(200),
        industry: z.string().min(1).max(100),
        description: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole === "VIEWER") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return createProject(input.teamId, input);
    }),

  list: teamProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ input }) => {
      return listProjects(input.teamId);
    }),

  get: teamProcedure
    .input(z.object({ teamId: z.string(), projectId: z.string() }))
    .query(async ({ input }) => {
      const project = await getProject(input.projectId, input.teamId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return project;
    }),

  update: teamProcedure
    .input(
      z.object({
        teamId: z.string(),
        projectId: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole === "VIEWER") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return updateProject(input.projectId, input.teamId, input);
    }),

  delete: teamProcedure
    .input(z.object({ teamId: z.string(), projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.teamRole !== "OWNER" && ctx.teamRole !== "ADMIN") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return deleteProject(input.projectId, input.teamId);
    }),
});
```

- [ ] **Step 4: Register project router**

Update `src/server/trpc/router.ts`:

```typescript
import { createRouter } from "./init";
import { authRouter } from "./routers/auth";
import { teamRouter } from "./routers/team";
import { projectRouter } from "./routers/project";

export const appRouter = createRouter({
  auth: authRouter,
  team: teamRouter,
  project: projectRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/server/routers/project.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/project.ts src/server/trpc/router.ts tests/server/routers/project.test.ts
git commit -m "feat: add project CRUD with team-scoped access"
```

---

### Task 10: Basic UI Components

**Files:**
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/dialog.tsx`

- [ ] **Step 1: Install Radix UI primitives**

```bash
npm install @radix-ui/react-dialog @radix-ui/react-slot
```

- [ ] **Step 2: Create Button component**

Create `src/components/ui/button.tsx`:

```tsx
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-gray-900 text-white shadow hover:bg-gray-800",
        outline: "border border-gray-300 bg-white hover:bg-gray-50",
        ghost: "hover:bg-gray-100",
        destructive: "bg-red-600 text-white shadow-sm hover:bg-red-700",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

```bash
npm install class-variance-authority
```

- [ ] **Step 3: Create Input component**

Create `src/components/ui/input.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
```

- [ ] **Step 4: Create Card component**

Create `src/components/ui/card.tsx`:

```tsx
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-lg border border-gray-200 bg-white shadow-sm", className)}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardTitle, CardContent };
```

- [ ] **Step 5: Create Dialog component**

Create `src/components/ui/dialog.tsx`:

```tsx
"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] rounded-lg border bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);

const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogTitle };
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/
git commit -m "feat: add base UI components (Button, Input, Card, Dialog)"
```

---

### Task 11: Auth Pages (Login + Register)

**Files:**
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/register/page.tsx`
- Create: `src/app/(auth)/layout.tsx`

- [ ] **Step 1: Create auth layout**

Create `src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-6 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Atlas</h1>
          <p className="mt-1 text-sm text-gray-500">产业链分析平台</p>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create login page**

Create `src/app/(auth)/login/page.tsx`:

```tsx
"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const callbackUrl = searchParams.get("callbackUrl") ?? "/app";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("邮箱或密码错误");
    } else {
      router.push(callbackUrl);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center">登录</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              邮箱
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              密码
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          没有账号？{" "}
          <Link href="/register" className="text-gray-900 underline">
            注册
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create register page**

Create `src/app/(auth)/register/page.tsx`:

```tsx
"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/trpc/auth.register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: { name, email, password },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.error?.message ?? "注册失败");
      }

      // Auto-login after registration
      await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center">注册</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              名称
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              邮箱
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              密码（至少8位）
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "注册中..." : "注册"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          已有账号？{" "}
          <Link href="/login" className="text-gray-900 underline">
            登录
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Verify pages render**

```bash
npm run dev
```

Visit http://localhost:3000/login and http://localhost:3000/register. Both pages should render with forms.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(auth\)/
git commit -m "feat: add login and register pages"
```

---

### Task 12: Authenticated App Layout + Dashboard

**Files:**
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/page.tsx`
- Create: `src/components/sidebar.tsx`
- Create: `src/components/team-switcher.tsx`
- Create: `src/app/(app)/projects/page.tsx`
- Create: `src/app/(app)/projects/new/page.tsx`
- Create: `src/app/(app)/team/page.tsx`
- Create: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Create middleware for auth protection**

Create `src/middleware.ts`:

```typescript
export { default } from "next-auth/middleware";

export const config = {
  matcher: ["/app/:path*"],
};
```

- [ ] **Step 2: Create sidebar**

Create `src/components/sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "项目", href: "/app/projects" },
  { label: "团队", href: "/app/team" },
  { label: "设置", href: "/app/settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-gray-50">
      <div className="p-4">
        <Link href="/app" className="text-xl font-bold">
          Atlas
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "block rounded-md px-3 py-2 text-sm transition-colors",
              pathname.startsWith(item.href)
                ? "bg-gray-200 font-medium text-gray-900"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-gray-200 p-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-gray-600"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          退出登录
        </Button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Create app layout**

Create `src/app/(app)/layout.tsx`:

```tsx
import { Sidebar } from "@/components/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-white p-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Create dashboard redirect**

Create `src/app/(app)/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function AppPage() {
  redirect("/app/projects");
}
```

- [ ] **Step 5: Create projects list page**

Create `src/app/(app)/projects/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ProjectsPage() {
  // TODO: Replace with trpc.project.list.useQuery() once team context is wired
  const projects: Array<{
    id: string;
    name: string;
    industry: string;
    updatedAt: string;
    chain?: { status: string };
  }> = [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">项目列表</h1>
        <Link href="/app/projects/new">
          <Button>新建项目</Button>
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 py-16">
          <p className="text-gray-500">还没有项目</p>
          <Link href="/app/projects/new" className="mt-4">
            <Button variant="outline">创建第一个项目</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/app/projects/${project.id}`}>
              <Card className="cursor-pointer transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle>{project.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-500">
                    行业：{project.industry}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create new project page**

Create `src/app/(app)/projects/new/page.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // TODO: Wire to trpc.project.create.useMutation()
    // For now, just navigate back
    router.push("/app/projects");
  }

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>新建项目</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                项目名称
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：AI产业链分析"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="industry" className="text-sm font-medium">
                行业关键词
              </label>
              <Input
                id="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="例如：AI、半导体、新能源"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium">
                描述（可选）
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400"
                placeholder="项目背景和目标..."
              />
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                取消
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "创建中..." : "创建项目"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Create placeholder team + settings pages**

Create `src/app/(app)/team/page.tsx`:

```tsx
export default function TeamPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">团队管理</h1>
      <p className="text-gray-500">团队管理功能将在后续版本中完善。</p>
    </div>
  );
}
```

Create `src/app/(app)/settings/page.tsx`:

```tsx
export default function SettingsPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">设置</h1>
      <p className="text-gray-500">设置页面将在后续版本中完善。</p>
    </div>
  );
}
```

- [ ] **Step 8: Verify the full flow**

```bash
npm run dev
```

1. Visit http://localhost:3000 — landing page
2. Visit http://localhost:3000/register — register form
3. Visit http://localhost:3000/login — login form
4. After login, redirect to /app/projects — sidebar + project list
5. Click "新建项目" — create project form

- [ ] **Step 9: Commit**

```bash
git add src/middleware.ts src/components/sidebar.tsx src/app/\(app\)/
git commit -m "feat: add authenticated app shell with sidebar and project pages"
```

---

### Task 13: Seed Script + Full Integration Verify

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json`

- [ ] **Step 1: Create seed script**

Create `prisma/seed.ts`:

```typescript
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  // Create demo user
  const user = await prisma.user.upsert({
    where: { email: "demo@atlas.dev" },
    update: {},
    create: {
      email: "demo@atlas.dev",
      name: "Demo User",
      passwordHash,
    },
  });

  // Create demo team
  const team = await prisma.team.create({
    data: {
      name: "Demo Team",
      members: {
        create: { userId: user.id, role: "OWNER" },
      },
    },
  });

  // Create demo project
  await prisma.project.create({
    data: {
      teamId: team.id,
      name: "AI 产业链分析",
      industry: "AI",
      description: "人工智能上下游产业链全景分析",
    },
  });

  console.log("Seed complete: demo@atlas.dev / password123");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 2: Add seed config to package.json**

Add to `package.json`:

```json
"prisma": {
  "seed": "npx tsx prisma/seed.ts"
}
```

```bash
npm install --save-dev tsx
```

- [ ] **Step 3: Run seed**

```bash
npx prisma db seed
```

Expected: "Seed complete: demo@atlas.dev / password123"

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: All tests pass (auth: 2, team: 6, invite: 4, project: 5 = 17 tests)

- [ ] **Step 5: Run build**

```bash
npm run build
```

Expected: Build succeeds with no errors

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts package.json
git commit -m "feat: add database seed script with demo user and project"
```

---

## Phase 1 Complete

After completing all 13 tasks, you have a working foundation:

- Next.js 15 app with TypeScript + Tailwind CSS
- PostgreSQL database with full schema (all entities from the spec)
- User registration + login (credentials, OAuth-ready)
- Team management (create, list, invite, role-based access)
- Project CRUD (team-scoped)
- tRPC API with auth + team middleware
- Test infrastructure with 17+ passing tests
- Basic UI (landing, auth pages, app shell with sidebar)
- Demo seed data

**Next phases:**
- Phase 2: AI Generation Pipeline (LLM Router + 5-step chain generation)
- Phase 3: Tree Visualization (D3.js interactive tree)
- Phase 4: Real-time Collaboration (Yjs + Hocuspocus)
