"use client";

import { CheckCircle2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { useAuth } from "../auth-provider";
import { homePathFor } from "../navigation";

const KNOWN_REASONS = [
  "invalid_state",
  "google_denied",
  "google_unavailable",
  "session_changed",
  "google_validation_failed",
  "email_not_verified",
  "account_exists",
  "already_linked",
  "verify_email_first",
  "account_unavailable",
] as const;

type Reason = (typeof KNOWN_REASONS)[number];

export function GoogleResultView() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const router = useRouter();
  const { completeExternalSignIn } = useAuth();
  const status = params.get("status");
  const reasonParam = params.get("reason");
  const started = useRef(false);
  const [restoreFailed, setRestoreFailed] = useState(false);

  useEffect(() => {
    if ((status !== "signed_in" && status !== "linked") || started.current) return;
    started.current = true;
    void completeExternalSignIn().then((user) => {
      if (user) router.replace(homePathFor(user));
      else setRestoreFailed(true);
    });
  }, [completeExternalSignIn, router, status]);

  if ((status === "signed_in" || status === "linked") && !restoreFailed) {
    return <EmptyState headingLevel={1} icon={<CheckCircle2 aria-hidden />} title={t("googleFinishing")} />;
  }

  // Only known values choose a message, so nothing from the URL is displayed.
  const reason = KNOWN_REASONS.find((known) => known === reasonParam) as Reason | undefined;
  const message = restoreFailed || !reason ? t("googleError.generic") : t(`googleError.${reason}`);

  return (
    <EmptyState headingLevel={1}
      icon={<ShieldAlert aria-hidden />}
      title={t("googleFailedTitle")}
      description={message}
      action={
        <Button asChild>
          <Link href="/login">{t("backToSignIn")}</Link>
        </Button>
      }
    />
  );
}
