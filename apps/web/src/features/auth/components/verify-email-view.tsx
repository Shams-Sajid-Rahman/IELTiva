"use client";

import { Loader2, MailX } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { api, ApiRequestError } from "@/lib/api-client";
import { useAuth } from "../auth-provider";
import { EmailRequestForm } from "./email-request-form";
import { AuthHeading } from "./form-parts";

export function VerifyEmailView() {
  const t = useTranslations("auth");
  const token = useSearchParams().get("token");
  const router = useRouter();
  const { status, refreshUser } = useAuth();
  const started = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    // Tokens are single use, so this must run only once, including under React Strict Mode.
    if (!token || started.current || status === "loading") return;
    started.current = true;
    void (async () => {
      try {
        await api.post("/auth/verify-email", { token }, { skipRefresh: true });
        if (status === "authenticated") await refreshUser();
        router.replace("/verify-email/success");
      } catch (error) {
        setFailure(error instanceof ApiRequestError ? error.message : t("genericError"));
      }
    })();
  }, [refreshUser, router, status, t, token]);

  if (token && !failure) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-12 text-center">
        <Loader2 className="text-primary size-8 animate-spin" aria-hidden />
        <p>{t("verifying")}</p>
      </div>
    );
  }

  return (
    <>
      {failure ? (
        <EmptyState headingLevel={1} className="pt-0" icon={<MailX aria-hidden />} title={t("verifyFailedTitle")} description={failure} />
      ) : (
        <AuthHeading title={t("verifyTitle")} description={t("verifyBody")} />
      )}
      <EmailRequestForm path="/auth/resend-verification" submitLabel={t("resendLink")} doneTitle={t("requestDoneTitle")} doneBody={t("resendDoneBody")} />
    </>
  );
}
