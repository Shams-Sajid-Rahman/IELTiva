import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { API_PREFIX, BODY_LIMIT } from "./config/constants.js";
import { csrfProtection } from "./middleware/csrf.js";
import { errorHandler } from "./middleware/error-handler.js";
import { globalRateLimit } from "./middleware/rate-limit.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { exposeRequestId, requestLogger } from "./middleware/request-context.js";
import { withCorrelationId } from "./utils/context.js";
import { createApiRouter } from "./routes/index.js";
import type { AppDependencies } from "./types/app.js";

export function createApp({ env, logger, checkDatabase, authRouter, platformRouter, paymentCallbackRouter, probeRouter }: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  // Forwarded headers are believed only from the configured number of trusted proxies.
  app.set("trust proxy", env.TRUST_PROXY);
  app.use(requestLogger(logger));
  app.use(exposeRequestId);
  app.use((req, _res, next) => withCorrelationId(String(req.id), next));
  app.use(helmet());
  app.use(cors({ origin: [env.FRONTEND_URL], credentials: true }));
  if (env.NODE_ENV !== "test") app.use(globalRateLimit());
  // Live tutor replies must reach the student as they're written, so a stream is never held back to compress it.
  app.use(compression({ filter: (req, res) => !req.path.includes("/messages") && compression.filter(req, res) }));
  // Gateway callbacks read their own raw body and can't carry a CSRF token, so they are handled before the general parsers.
  if (paymentCallbackRouter) app.use(`${API_PREFIX}/payments`, paymentCallbackRouter);
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));
  app.use(cookieParser());

  app.use(
    API_PREFIX,
    csrfProtection(env.CSRF_SECRET, env.FRONTEND_URL),
    createApiRouter({ env, checkDatabase, authRouter, platformRouter, probeRouter }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
