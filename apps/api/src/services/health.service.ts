import type { HealthData } from "@ieltiva/shared";
import { API_VERSION, APP_NAME, DATABASE_CHECK_TIMEOUT_MS } from "../config/constants.js";
import type { DatabaseCheck } from "../types/app.js";

async function isDatabaseConnected(checkDatabase: DatabaseCheck, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Database check timed out")), timeoutMs);
  });
  try {
    await Promise.race([checkDatabase(), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth(
  checkDatabase: DatabaseCheck,
  environment: string,
  timeoutMs = DATABASE_CHECK_TIMEOUT_MS,
): Promise<HealthData> {
  const connected = await isDatabaseConnected(checkDatabase, timeoutMs);
  return {
    application: APP_NAME,
    apiVersion: API_VERSION,
    environment,
    status: connected ? "healthy" : "unhealthy",
    database: connected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  };
}
