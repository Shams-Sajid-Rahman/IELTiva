import type { Server } from "node:http";
import { SHUTDOWN_TIMEOUT_MS } from "../config/constants.js";
import type { Logger } from "./logger.js";

type ShutdownOptions = {
  server: Pick<Server, "close" | "closeIdleConnections">;
  disconnect: () => Promise<void>;
  logger: Pick<Logger, "info" | "error">;
  exit: (code: number) => void;
  timeoutMs?: number;
};

/** Stops new requests first, so in-flight requests can finish using the database. Later signals are ignored. */
export function createShutdown({ server, disconnect, logger, exit, timeoutMs = SHUTDOWN_TIMEOUT_MS }: ShutdownOptions) {
  let started = false;

  return async (signal: string) => {
    if (started) return;
    started = true;
    logger.info({ signal }, "Shutting down");

    const forced = setTimeout(() => {
      logger.error("Shutdown timed out");
      exit(1);
    }, timeoutMs);
    forced.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
      await disconnect();
      clearTimeout(forced);
      exit(0);
    } catch (error) {
      clearTimeout(forced);
      logger.error({ err: error }, "Shutdown failed");
      exit(1);
    }
  };
}
