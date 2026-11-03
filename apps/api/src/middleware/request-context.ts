import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { pinoHttp } from "pino-http";
import type { Logger } from "../utils/logger.js";

/**
 * Request IDs are always generated here, so a client can't inject their own into logs.
 * Query strings and response headers stay out of logs, because OAuth URLs and cookies carry secrets.
 */
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: () => randomUUID(),
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url.split("?")[0],
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}

export const exposeRequestId: RequestHandler = (req, res, next) => {
  res.setHeader("X-Request-Id", String(req.id));
  next();
};
