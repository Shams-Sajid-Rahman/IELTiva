import { createHmac, randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { COOKIE_CSRF } from "../config/auth.js";
import { AppError } from "../utils/app-error.js";
import { safeEqual } from "../utils/crypto.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createCsrfToken(secret: string) {
  const value = randomBytes(32).toString("base64url");
  return `${value}.${sign(value, secret)}`;
}

function isValidToken(token: string, secret: string) {
  const [value, signature, extra] = token.split(".");
  return Boolean(value && signature && !extra && safeEqual(signature, sign(value, secret)));
}

/** Signed double-submit token plus an Origin check. Applies to every state-changing API request. */
export function csrfProtection(secret: string, allowedOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.get("origin");
    const cookie: unknown = req.cookies?.[COOKIE_CSRF];
    const header = req.get("x-csrf-token");
    const valid =
      (!origin || origin === allowedOrigin) &&
      typeof cookie === "string" &&
      typeof header === "string" &&
      safeEqual(cookie, header) &&
      isValidToken(cookie, secret);
    next(valid ? undefined : new AppError(403, "CSRF_FAILED", "Your session security check failed. Please refresh and try again."));
  };
}
