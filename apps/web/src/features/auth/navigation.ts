import type { AuthUser, UserRole } from "@ieltiva/shared";

export const STAFF_ROLES: UserRole[] = ["ADMIN", "SUPER_ADMIN", "EDITOR"];

export function homePathFor(user: Pick<AuthUser, "roles">) {
  return user.roles.some((role) => STAFF_ROLES.includes(role)) ? "/admin" : "/dashboard";
}

/** Accepts only paths on this site, so a crafted link can't send someone elsewhere after sign-in. */
export function safeNextPath(next: string | null | undefined) {
  // Browsers remove tabs and newlines from URLs, which would turn "/\t/evil.example" into "//evil.example".
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return null;
  const origin = "https://ieltiva.invalid";
  if (new URL(next, origin).origin !== origin) return null;
  if (/^\/(login|register)(\/|\?|$)/.test(next)) return null;
  return next;
}
