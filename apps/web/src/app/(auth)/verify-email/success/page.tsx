import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Email verified" };

export default async function VerifySuccessPage() {
  const t = await getTranslations("auth");
  return (
    <EmptyState headingLevel={1}
      icon={<CheckCircle2 aria-hidden />}
      title={t("verifiedTitle")}
      description={t("verifiedBody")}
      action={
        <Button asChild>
          <Link href="/login">{t("continue")}</Link>
        </Button>
      }
    />
  );
}
