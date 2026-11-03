export const COOKIE_ACCESS = "ieltiva_access";
export const COOKIE_REFRESH = "ieltiva_refresh";
export const COOKIE_CSRF = "ieltiva_csrf";
export const COOKIE_OAUTH = "ieltiva_oauth";

export const REFRESH_COOKIE_PATH = "/api/v1/auth";
export const OAUTH_COOKIE_PATH = "/api/v1/auth/google";
export const OAUTH_FLOW_MINUTES = 10;

export const EMAIL_VERIFICATION_HOURS = 24;
export const PASSWORD_RESET_MINUTES = 60;

/** One recovery email per address in this period, whichever IP asks. */
export const EMAIL_COOLDOWN_SECONDS = 60;

export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MINUTES = 15;

export const DEFAULT_ROLE_CODE = "STUDENT";

export const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export type AuthRateLimits = {
  login: number;
  register: number;
  refresh: number;
  emailAction: number;
  tokenAction: number;
};

/** Requests per IP in each 15-minute window. Students behind one shared network were considered. */
export const DEFAULT_RATE_LIMITS: AuthRateLimits = {
  login: 30,
  register: 15,
  refresh: 120,
  emailAction: 10,
  tokenAction: 30,
};
