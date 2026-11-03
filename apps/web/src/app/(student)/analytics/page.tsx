import type { Metadata } from "next";
import { AnalyticsPage } from "@/features/analytics/student";

export const metadata: Metadata = { title: "Progress", robots: { index: false, follow: false } };

export default function Page() {
  return <AnalyticsPage />;
}
