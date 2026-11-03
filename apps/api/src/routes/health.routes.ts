import { Router } from "express";
import { createHealthController } from "../controllers/health.controller.js";
import type { DatabaseCheck } from "../types/app.js";

export function createHealthRouter(checkDatabase: DatabaseCheck, environment: string) {
  const router = Router();
  router.get("/", createHealthController(checkDatabase, environment));
  return router;
}
