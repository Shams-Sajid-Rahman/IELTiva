import { Router } from "express";
import type { AppDependencies } from "../types/app.js";
import { createHealthRouter } from "./health.routes.js";

export function createApiRouter({ env, checkDatabase, authRouter }: Pick<AppDependencies, "env" | "checkDatabase" | "authRouter">) {
  const router = Router();
  router.use("/health", createHealthRouter(checkDatabase, env.NODE_ENV));
  if (authRouter) router.use("/auth", authRouter);
  return router;
}
