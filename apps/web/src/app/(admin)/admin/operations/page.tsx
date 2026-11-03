import type { Metadata } from "next";
import { SystemHealthPage } from "@/features/platform/admin/system-health";

export const metadata: Metadata = { title: "System health", robots: { index: false, follow: false } };

export default function Page() {
  return <SystemHealthPage />;
}
