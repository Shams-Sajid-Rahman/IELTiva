"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";

/** A full page navigation, because the API must set its short-lived OAuth cookie and redirect to Google. */
export function GoogleButton() {
  const t = useTranslations("auth");
  return (
    <>
      <Button asChild variant="outline" size="lg" className="h-11 w-full">
        <a href={api.url("/auth/google")}>
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
            <path fill="currentColor" d="M12 11v2.8h6.5c-.3 1.6-1.9 4.7-6.5 4.7-3.9 0-7.1-3.2-7.1-7.2S8.1 4.1 12 4.1c2.2 0 3.7 1 4.6 1.8l2.2-2.1C17.3 2.4 14.900 1.400 12 1.400 6.500 1.400 2 5.900 2 11.300S6.500 21.200 12 21.200c5.800 0 9.600-4.100 9.600-9.800 0-.7-.1-1.200-.2-1.700H12z" />
          </svg>
          {t("continueWithGoogle")}
        </a>
      </Button>
      <div className="my-5 flex items-center gap-3" role="separator" aria-label={t("or")}>
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-sm">{t("or")}</span>
        <span className="bg-border h-px flex-1" />
      </div>
    </>
  );
}
