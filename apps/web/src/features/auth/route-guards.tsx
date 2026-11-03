"use client";

import type { UserRole } from "@ieltiva/shared";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "./auth-provider";
import { homePathFor, safeNextPath } from "./navigation";

function AuthLoading() {
  const t = useTranslations("auth");
  return (
    <div role="status" aria-label={t("loading")} className="mx-auto w-full max-w-md space-y-4 px-4 py-16">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

/**
 * Improves the experience only. The API enforces access on every request.
 * Children render only after the session and role are confirmed, so protected content never flashes.
 */
export function RequireAuth({ roles, children }: { roles?: UserRole[]; children: ReactNode }) {
  const t = useTranslations("auth");
  const { status, user, hasRole, signedOutDeliberately } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(signedOutDeliberately ? "/login" : `/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [pathname, router, signedOutDeliberately, status]);

  if (status !== "authenticated" || !user) return <AuthLoading />;

  // Showing a message rather than redirecting can't create a redirect loop.
  if (roles && !hasRole(...roles)) {
    return (
      <EmptyState headingLevel={1}
        className="py-24"
        icon={<ShieldAlert aria-hidden />}
        title={t("forbiddenTitle")}
        description={t("forbiddenBody")}
        action={
          <Button asChild>
            <Link href={homePathFor(user)}>{t("goToDashboard")}</Link>
          </Button>
        }
      />
    );
  }
  return children;
}

/** Sends signed-in people away from sign-in pages, to where they were going or to their home page. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));

  useEffect(() => {
    if (status === "authenticated" && user) router.replace(next ?? homePathFor(user));
  }, [next, router, status, user]);

  return status === "unauthenticated" ? children : <AuthLoading />;
}
