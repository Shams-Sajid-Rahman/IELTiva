import { rateLimit } from "express-rate-limit";
import { FIFTEEN_MINUTES_MS } from "../config/auth.js";
import { AppError } from "../utils/app-error.js";

export function authRateLimit(limit: number) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many attempts. Please wait and try again.")),
  });
}
