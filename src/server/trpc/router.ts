import { createRouter } from "./init";
import { authRouter } from "./routers/auth";
import { teamRouter } from "./routers/team";
import { projectRouter } from "./routers/project";
import { generationRouter } from "./routers/generation";
import { commentRouter } from "./routers/comment";
import { statusRouter } from "./routers/status";
import { picksRouter } from "./routers/picks";

export const appRouter = createRouter({
  auth: authRouter,
  team: teamRouter,
  project: projectRouter,
  generation: generationRouter,
  comment: commentRouter,
  status: statusRouter,
  picks: picksRouter,
});

export type AppRouter = typeof appRouter;
