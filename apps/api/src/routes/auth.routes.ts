import { Router } from "express";
import { DEFAULT_RATE_LIMITS, type AuthRateLimits } from "../config/auth.js";
import type { Env } from "../config/env.js";
import { createAuthController } from "../controllers/auth.controller.js";
import { createAuthMiddleware } from "../middleware/authenticate.js";
import { authRateLimit } from "../middleware/rate-limit.js";
import type { AuthService } from "../services/auth.service.js";
import type { OAuthProvider } from "../services/google-oauth.service.js";
import type { TokenService } from "../services/token.service.js";

type Deps = {
  env: Pick<Env, "FRONTEND_URL" | "CSRF_SECRET" | "COOKIE_DOMAIN" | "COOKIE_SECURE">;
  auth: AuthService;
  tokens: TokenService;
  google: OAuthProvider | null;
  limits?: AuthRateLimits;
};

export function createAuthRouter({ env, auth, tokens, google, limits = DEFAULT_RATE_LIMITS }: Deps) {
  const router = Router();
  const controller = createAuthController({ env, auth, tokens, google });
  const { authenticateUser, optionalAuthentication } = createAuthMiddleware({ tokens, auth });
  const emailLimit = authRateLimit(limits.emailAction);
  const tokenLimit = authRateLimit(limits.tokenAction);

  router.get("/csrf", controller.csrf);
  router.post("/register", authRateLimit(limits.register), controller.register);
  router.post("/login", authRateLimit(limits.login), controller.login);
  router.post("/refresh", authRateLimit(limits.refresh), controller.refresh);
  router.post("/logout", optionalAuthentication, controller.logout);
  router.post("/logout-all", authenticateUser, controller.logoutAll);
  router.get("/me", authenticateUser, controller.me);
  router.post("/verify-email", tokenLimit, controller.verifyEmail);
  router.post("/resend-verification", emailLimit, controller.resendVerification);
  router.post("/forgot-password", emailLimit, controller.forgotPassword);
  router.post("/reset-password", tokenLimit, controller.resetPassword);
  router.get("/google", tokenLimit, optionalAuthentication, controller.googleStart);
  router.get("/google/callback", tokenLimit, optionalAuthentication, controller.googleCallback);

  return router;
}
