import { Router } from "express";
import type { AppDependencies } from "../types/app.js";
import { createHealthRouter } from "./health.routes.js";

export function createApiRouter({ env, checkDatabase, authRouter, platformRouter, probeRouter }: Pick<AppDependencies, "env" | "checkDatabase" | "authRouter" | "platformRouter" | "probeRouter">) {
  const router = Router();
  if (probeRouter) router.use("/health", probeRouter);
  router.use("/health", createHealthRouter(checkDatabase, env.NODE_ENV));
  if (authRouter) router.use("/auth", authRouter);
  if (platformRouter) router.use(platformRouter);
  return router;
}
