import type { Env } from "../config/env.js";
import type { Logger } from "../utils/logger.js";
import type { Router } from "express";

export type DatabaseCheck = () => Promise<void>;

export type AppDependencies = {
  env: Pick<Env, "NODE_ENV" | "FRONTEND_URL" | "TRUST_PROXY" | "CSRF_SECRET" | "COOKIE_DOMAIN" | "COOKIE_SECURE">;
  logger: Logger;
  checkDatabase: DatabaseCheck;
  authRouter?: Router;
  platformRouter?: Router;
};
