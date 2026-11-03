import type { CookieOptions, Response } from "express";
import {
  COOKIE_ACCESS,
  COOKIE_CSRF,
  COOKIE_OAUTH,
  COOKIE_REFRESH,
  OAUTH_COOKIE_PATH,
  OAUTH_FLOW_MINUTES,
  REFRESH_COOKIE_PATH,
} from "../config/auth.js";
import type { Env } from "../config/env.js";

export type CookieEnv = Pick<Env, "COOKIE_DOMAIN" | "COOKIE_SECURE">;

function base(env: CookieEnv): CookieOptions {
  return {
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setSessionCookies(
  res: Response,
  env: CookieEnv,
  tokens: { accessToken: string; accessExpiresAt: Date; refreshToken: string; refreshExpiresAt: Date },
) {
  res.cookie(COOKIE_ACCESS, tokens.accessToken, { ...base(env), httpOnly: true, path: "/", expires: tokens.accessExpiresAt });
  res.cookie(COOKIE_REFRESH, tokens.refreshToken, {
    ...base(env),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    expires: tokens.refreshExpiresAt,
  });
}

export function clearSessionCookies(res: Response, env: CookieEnv) {
  res.clearCookie(COOKIE_ACCESS, { ...base(env), httpOnly: true, path: "/" });
  res.clearCookie(COOKIE_REFRESH, { ...base(env), httpOnly: true, path: REFRESH_COOKIE_PATH });
}

/** Readable by the web app on purpose, because it must copy this value into a request header. */
export function setCsrfCookie(res: Response, env: CookieEnv, token: string) {
  res.cookie(COOKIE_CSRF, token, { ...base(env), httpOnly: false, path: "/" });
}

export function setOAuthCookie(res: Response, env: CookieEnv, value: string) {
  res.cookie(COOKIE_OAUTH, value, {
    ...base(env),
    httpOnly: true,
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_FLOW_MINUTES * 60 * 1000,
  });
}

export function clearOAuthCookie(res: Response, env: CookieEnv) {
  res.clearCookie(COOKIE_OAUTH, { ...base(env), httpOnly: true, path: OAUTH_COOKIE_PATH });
}
