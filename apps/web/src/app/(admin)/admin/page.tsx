import type { Metadata } from "next";
import { AdminOverview } from "@/features/platform/admin/overview";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminOverview />;
}
