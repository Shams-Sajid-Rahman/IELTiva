import type { RequestHandler } from "express";
import { COOKIE_ACCESS } from "../config/auth.js";
import type { TokenService } from "../services/token.service.js";
import type { AuthService } from "../services/auth.service.js";
import { AppError } from "../utils/app-error.js";

type Deps = { tokens: TokenService; auth: Pick<AuthService, "loadAuthContext"> };

export function createAuthMiddleware({ tokens, auth }: Deps) {
  async function resolve(cookie: unknown) {
    if (typeof cookie !== "string") return null;
    const claims = await tokens.verifyAccessToken(cookie);
    return claims ? auth.loadAuthContext(claims.userId, claims.sessionId) : null;
  }

  /** The token only identifies the session. Status, roles and permissions always come from the database. */
  const authenticateUser: RequestHandler = async (req, _res, next) => {
    const context = await resolve(req.cookies?.[COOKIE_ACCESS]);
    if (!context) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
    req.auth = context;
    next();
  };

  const optionalAuthentication: RequestHandler = async (req, _res, next) => {
    const context = await resolve(req.cookies?.[COOKIE_ACCESS]);
    if (context) req.auth = context;
    next();
  };

  return { authenticateUser, optionalAuthentication };
}

export function requireRole(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
    if (!req.auth.roles.some((role) => roles.includes(role))) {
      throw new AppError(403, "FORBIDDEN", "You don't have access to this resource.");
    }
    next();
  };
}

export function requirePermission(...permissions: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
    if (!permissions.every((permission) => req.auth?.permissions.includes(permission))) {
      throw new AppError(403, "FORBIDDEN", "You don't have access to this resource.");
    }
    next();
  };
}
