import { createRouter } from "./init";
import { authRouter } from "./routers/auth";
import { teamRouter } from "./routers/team";

export const appRouter = createRouter({
  auth: authRouter,
  team: teamRouter,
});

export type AppRouter = typeof appRouter;
