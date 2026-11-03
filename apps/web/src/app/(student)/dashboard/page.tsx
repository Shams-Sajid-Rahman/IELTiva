import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountSummary } from "@/features/auth/components/account-summary";
import { RequireAuth } from "@/features/auth/route-guards";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };

export default async function DashboardPage() {
  const t = await getTranslations("auth");
  return (
    <RequireAuth>
      <AccountSummary title={t("studentTitle")} description={t("studentBody")} />
    </RequireAuth>
  );
}
