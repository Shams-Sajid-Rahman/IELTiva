import { createApp } from "../src/app.js";
import type { DatabaseCheck } from "../src/types/app.js";
import { createLogger } from "../src/utils/logger.js";

export const testEnv = { NODE_ENV: "test" as const, FRONTEND_URL: "http://localhost:3000", TRUST_PROXY: 0 };

export function buildApp(checkDatabase: DatabaseCheck = async () => {}) {
  return createApp({ env: testEnv, logger: createLogger("silent"), checkDatabase });
}
