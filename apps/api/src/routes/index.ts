import { Router } from "express";
import type { AppDependencies } from "../types/app.js";
import { createHealthRouter } from "./health.routes.js";

export function createApiRouter({ env, checkDatabase, authRouter, platformRouter, probeRouter, publicRouter }: Pick<AppDependencies, "env" | "checkDatabase" | "authRouter" | "platformRouter" | "probeRouter" | "publicRouter">) {
  const router = Router();
  if (probeRouter) router.use("/health", probeRouter);
  router.use("/health", createHealthRouter(checkDatabase, env.NODE_ENV));
  if (publicRouter) router.use(publicRouter);
  if (authRouter) router.use("/auth", authRouter);
  if (platformRouter) router.use(platformRouter);
  return router;
}
