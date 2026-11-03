import type { Metadata } from "next";
import { SettingsAdminPage } from "@/features/platform/admin/operations";

export const metadata: Metadata = { title: "Platform settings", robots: { index: false, follow: false } };

export default function Page() {
  return <SettingsAdminPage />;
}
