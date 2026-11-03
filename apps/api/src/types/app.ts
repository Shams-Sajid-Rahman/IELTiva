import type { Env } from "../config/env.js";
import type { Logger } from "../utils/logger.js";

export type DatabaseCheck = () => Promise<void>;

export type AppDependencies = {
  env: Pick<Env, "NODE_ENV" | "FRONTEND_URL" | "TRUST_PROXY">;
  logger: Logger;
  checkDatabase: DatabaseCheck;
};
