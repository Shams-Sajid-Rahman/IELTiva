import { Router } from "express";
import type { AppDependencies } from "../types/app.js";
import { createHealthRouter } from "./health.routes.js";

export function createApiRouter({ env, checkDatabase, authRouter, platformRouter }: Pick<AppDependencies, "env" | "checkDatabase" | "authRouter" | "platformRouter">) {
  const router = Router();
  router.use("/health", createHealthRouter(checkDatabase, env.NODE_ENV));
  if (authRouter) router.use("/auth", authRouter);
  if (platformRouter) router.use(platformRouter);
  return router;
}
