import { randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { COOKIE_OAUTH, COOKIE_REFRESH, OAUTH_FLOW_MINUTES } from "../config/auth.js";
import type { Env } from "../config/env.js";
import { createCsrfToken } from "../middleware/csrf.js";
import type { AuthService } from "../services/auth.service.js";
import type { OAuthProvider } from "../services/google-oauth.service.js";
import type { TokenService } from "../services/token.service.js";
import type { AuthContext, RequestMeta } from "../types/auth.js";
import { sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";
import { clearOAuthCookie, clearSessionCookies, setCsrfCookie, setOAuthCookie, setSessionCookies } from "../utils/auth-cookies.js";
import { safeEqual } from "../utils/crypto.js";
import { emailSchema, googleStartSchema, loginSchema, registerSchema, resetPasswordSchema, tokenSchema } from "../validators/auth.validators.js";

type Deps = {
  env: Pick<Env, "FRONTEND_URL" | "CSRF_SECRET" | "COOKIE_DOMAIN" | "COOKIE_SECURE">;
  auth: AuthService;
  tokens: TokenService;
  google: OAuthProvider | null;
};

function metaOf(req: Request): RequestMeta {
  return { userAgent: req.get("user-agent")?.slice(0, 512), ipAddress: req.ip };
}

function currentUser(req: Request): AuthContext {
  if (!req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return req.auth;
}

const random = () => randomBytes(32).toString("base64url");

export function createAuthController({ env, auth, tokens, google }: Deps) {
  /** Runs after responding, so timing doesn't reveal whether an account exists. */
  function inBackground(req: Request, work: () => Promise<void>) {
    work().catch((error: unknown) => req.log.error({ err: error }, "Background auth task failed"));
  }

  function redirectResult(res: Response, status: string, reason?: string) {
    const params = new URLSearchParams({ status, ...(reason ? { reason } : {}) });
    res.redirect(302, `${env.FRONTEND_URL}/auth/google/result?${params}`);
  }

  const handlers = {
    csrf: ((_req, res) => {
      const csrfToken = createCsrfToken(env.CSRF_SECRET);
      setCsrfCookie(res, env, csrfToken);
      sendSuccess(res, "Security token issued", { csrfToken });
    }) as RequestHandler,

    register: (async (req, res) => {
      const { firstName, lastName, email, password } = registerSchema.parse(req.body);
      const data = await auth.register({ firstName, lastName, email, password });
      sendSuccess(res, "Account created. Please verify your email.", data, 201);
    }) as RequestHandler,

    login: (async (req, res) => {
      const { user, session } = await auth.login(loginSchema.parse(req.body), metaOf(req));
      setSessionCookies(res, env, session);
      sendSuccess(res, "Signed in", { user });
    }) as RequestHandler,

    refresh: (async (req, res) => {
      const token: unknown = req.cookies?.[COOKIE_REFRESH];
      if (typeof token !== "string") throw new AppError(401, "UNAUTHENTICATED", "Your session has ended. Please sign in again.");
      try {
        setSessionCookies(res, env, await auth.refresh(token, metaOf(req)));
      } catch (error) {
        clearSessionCookies(res, env);
        throw error;
      }
      sendSuccess(res, "Session refreshed", null);
    }) as RequestHandler,

    logout: (async (req, res) => {
      const refreshToken: unknown = req.cookies?.[COOKIE_REFRESH];
      await auth.logout({
        ...(req.auth ? { sessionId: req.auth.sessionId } : {}),
        ...(typeof refreshToken === "string" ? { refreshToken } : {}),
      });
      clearSessionCookies(res, env);
      sendSuccess(res, "Signed out", null);
    }) as RequestHandler,

    logoutAll: (async (req, res) => {
      await auth.revokeAllSessions(currentUser(req).userId);
      clearSessionCookies(res, env);
      sendSuccess(res, "Signed out of all sessions", null);
    }) as RequestHandler,

    me: (async (req, res) => {
      sendSuccess(res, "Current user", { user: await auth.getUser(currentUser(req).userId) });
    }) as RequestHandler,

    verifyEmail: (async (req, res) => {
      await auth.verifyEmail(tokenSchema.parse(req.body).token);
      sendSuccess(res, "Email verified", null);
    }) as RequestHandler,

    resendVerification: ((req, res) => {
      const { email } = emailSchema.parse(req.body);
      sendSuccess(res, "If that account needs verifying, we'll send an email.", null, 202);
      inBackground(req, () => auth.resendVerification(email));
    }) as RequestHandler,

    forgotPassword: ((req, res) => {
      const { email } = emailSchema.parse(req.body);
      sendSuccess(res, "If that account exists, we'll send a reset email.", null, 202);
      inBackground(req, () => auth.forgotPassword(email));
    }) as RequestHandler,

    resetPassword: (async (req, res) => {
      const { token, password } = resetPasswordSchema.parse(req.body);
      await auth.resetPassword(token, password);
      clearSessionCookies(res, env);
      sendSuccess(res, "Password updated. Please sign in.", null);
    }) as RequestHandler,

    googleStart: (async (req, res) => {
      // People reach this by navigation, so they get a readable page rather than raw JSON.
      if (!google) {
        redirectResult(res, "error", "google_unavailable");
        return;
      }
      const { intent } = googleStartSchema.parse(req.query);
      if (intent === "link" && !req.auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to link your Google account.");
      const flow = { state: random(), nonce: random(), codeVerifier: random() };
      const stored = { ...flow, ...(intent === "link" && req.auth ? { linkUserId: req.auth.userId } : {}) };
      setOAuthCookie(res, env, await tokens.signOAuthFlow(stored, OAUTH_FLOW_MINUTES));
      res.redirect(302, google.buildAuthorizationUrl(flow));
    }) as RequestHandler,

    googleCallback: (async (req, res) => {
      if (!google) throw new AppError(503, "SERVICE_UNAVAILABLE", "Google sign-in isn't available.");
      const cookie: unknown = req.cookies?.[COOKIE_OAUTH];
      clearOAuthCookie(res, env);
      const flow = typeof cookie === "string" ? await tokens.verifyOAuthFlow(cookie) : null;
      const { state, code, error } = req.query;

      if (!flow || typeof state !== "string" || !safeEqual(state, flow.state)) {
        redirectResult(res, "error", "invalid_state");
        return;
      }
      if (error || typeof code !== "string") {
        redirectResult(res, "error", "google_denied");
        return;
      }
      if (flow.linkUserId && req.auth?.userId !== flow.linkUserId) {
        redirectResult(res, "error", "session_changed");
        return;
      }

      let identity;
      try {
        identity = await google.exchangeCode(code, flow);
      } catch (failure) {
        req.log.warn({ err: failure }, "Google sign-in validation failed");
        redirectResult(res, "error", "google_validation_failed");
        return;
      }

      const outcome = await auth.resolveGoogleIdentity(identity, flow.linkUserId ? req.auth : undefined);
      if (outcome.kind === "rejected") {
        redirectResult(res, "error", outcome.reason);
        return;
      }
      if (outcome.kind === "signed_in") {
        setSessionCookies(res, env, await auth.issueSession(outcome.userId, metaOf(req)));
      }
      redirectResult(res, outcome.kind);
    }) as RequestHandler,
  };

  return handlers;
}
