import type { UserRole } from "./domain.js";

/** The only user shape the API sends to clients. It never includes password or token data. */
export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  roles: UserRole[];
};
