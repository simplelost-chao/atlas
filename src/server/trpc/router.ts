import { createRouter } from "./init";
import { authRouter } from "./routers/auth";
import { teamRouter } from "./routers/team";
import { projectRouter } from "./routers/project";
import { generationRouter } from "./routers/generation";

export const appRouter = createRouter({
  auth: authRouter,
  team: teamRouter,
  project: projectRouter,
  generation: generationRouter,
});

export type AppRouter = typeof appRouter;
