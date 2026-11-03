import type { Metadata } from "next";
import { AdminPackagesPage } from "@/features/billing/admin";

export const metadata: Metadata = { title: "Packages", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminPackagesPage />;
}
