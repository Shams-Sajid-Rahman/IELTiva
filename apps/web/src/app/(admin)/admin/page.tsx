import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountSummary } from "@/features/auth/components/account-summary";
import { RequireAuth } from "@/features/auth/route-guards";
import { STAFF_ROLES } from "@/features/auth/navigation";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const t = await getTranslations("auth");
  return (
    <RequireAuth roles={STAFF_ROLES}>
      <AccountSummary title={t("adminTitle")} description={t("adminBody")} />
    </RequireAuth>
  );
}
