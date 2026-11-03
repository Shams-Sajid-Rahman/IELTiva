import type { AuthUser, UserRole } from "@ieltiva/shared";

export const STAFF_ROLES: UserRole[] = ["ADMIN", "SUPER_ADMIN", "EDITOR"];

export function homePathFor(user: Pick<AuthUser, "roles">) {
  return user.roles.some((role) => STAFF_ROLES.includes(role)) ? "/admin" : "/dashboard";
}

/** Accepts only paths on this site, so a crafted link can't send someone elsewhere after sign-in. */
export function safeNextPath(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  if (/^\/(login|register)(\/|\?|$)/.test(next)) return null;
  return next;
}
