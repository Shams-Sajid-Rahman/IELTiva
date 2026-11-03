import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { pinoHttp } from "pino-http";
import type { Logger } from "../utils/logger.js";

/** Request IDs are always generated here, so a client can't inject its own into logs. */
export function requestLogger(logger: Logger) {
  return pinoHttp({ logger, genReqId: () => randomUUID() });
}

export const exposeRequestId: RequestHandler = (req, res, next) => {
  res.setHeader("X-Request-Id", String(req.id));
  next();
};
