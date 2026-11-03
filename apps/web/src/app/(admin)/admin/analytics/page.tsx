import type { Metadata } from "next";
import { AdminAnalyticsPage } from "@/features/analytics/admin";

export const metadata: Metadata = { title: "Platform analytics", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminAnalyticsPage />;
}
