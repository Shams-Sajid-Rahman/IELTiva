"use client";

import type { AuthUser, LoginInput, RegisterInput, UserRole } from "@ieltiva/shared";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api as defaultApi, ApiRequestError, type ApiClient } from "@/lib/api-client";

type Status = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: Status;
  user: AuthUser | null;
  /** True after a deliberate sign-out, when the next person shouldn't return to the previous page. */
  signedOutDeliberately: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<{ verificationEmailDelivered: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<AuthUser | null>;
  completeExternalSignIn: () => Promise<AuthUser | null>;
  hasRole: (...roles: UserRole[]) => boolean;
  hasPermission: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Not a credential. It only avoids a failing session check for visitors who have never signed in.
const SESSION_HINT = "ieltiva_session_hint";

function readHint() {
  try {
    return localStorage.getItem(SESSION_HINT) === "1";
  } catch {
    return false;
  }
}

function writeHint(signedIn: boolean) {
  try {
    if (signedIn) localStorage.setItem(SESSION_HINT, "1");
    else localStorage.removeItem(SESSION_HINT);
  } catch {
    // Without storage, the session simply isn't restored automatically.
  }
}

export function AuthProvider({ children, client = defaultApi }: { children: ReactNode; client?: ApiClient }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [signedOutDeliberately, setSignedOutDeliberately] = useState(false);

  const applySignedOut = useCallback(() => {
    writeHint(false);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const applyUser = useCallback((next: AuthUser) => {
    writeHint(true);
    setSignedOutDeliberately(false);
    setUser(next);
    setStatus("authenticated");
    return next;
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await client.get<{ user: AuthUser }>("/auth/me");
      return applyUser(data.user);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        applySignedOut();
      } else {
        // A network failure isn't proof the session ended, so keep the hint for the next visit.
        setUser(null);
        setStatus("unauthenticated");
      }
      return null;
    }
  }, [applySignedOut, applyUser, client]);

  useEffect(() => {
    client.setSessionExpiredHandler(applySignedOut);
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (readHint()) await refreshUser();
      else setStatus("unauthenticated");
    })();
    return () => {
      cancelled = true;
    };
  }, [applySignedOut, client, refreshUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      signedOutDeliberately,
      refreshUser,
      completeExternalSignIn: refreshUser,
      async login(input) {
        const data = await client.post<{ user: AuthUser }>("/auth/login", input, { skipRefresh: true });
        return applyUser(data.user);
      },
      register: (input) => client.post("/auth/register", input, { skipRefresh: true }),
      async logout() {
        setSignedOutDeliberately(true);
        try {
          await client.post("/auth/logout", {}, { skipRefresh: true });
        } finally {
          applySignedOut();
        }
      },
      hasRole: (...roles) => Boolean(user?.roles.some((role) => roles.includes(role))),
      hasPermission: (permission) => Boolean(user?.permissions.includes(permission)),
    }),
    [applySignedOut, applyUser, client, refreshUser, signedOutDeliberately, status, user],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const context = use(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
