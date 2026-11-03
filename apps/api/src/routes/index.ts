import { Router } from "express";
import type { AppDependencies } from "../types/app.js";
import { createHealthRouter } from "./health.routes.js";

export function createApiRouter({ env, checkDatabase }: Pick<AppDependencies, "env" | "checkDatabase">) {
  const router = Router();
  router.use("/health", createHealthRouter(checkDatabase, env.NODE_ENV));
  return router;
}
