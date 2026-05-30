import { createRouter } from "./init";
import { authRouter } from "./routers/auth";

export const appRouter = createRouter({
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
