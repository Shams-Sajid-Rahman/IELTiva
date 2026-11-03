import type { Metadata } from "next";
import { ModulesPage } from "@/features/platform/admin/content";

export const metadata: Metadata = { title: "Learning modules", robots: { index: false, follow: false } };

export default function Page() {
  return <ModulesPage />;
}
