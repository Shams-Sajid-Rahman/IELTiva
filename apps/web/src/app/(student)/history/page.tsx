import type { Metadata } from "next";
import { HistoryPage } from "@/features/platform/student/account";

export const metadata: Metadata = { title: "Learning history", robots: { index: false, follow: false } };

export default function Page() {
  return <HistoryPage />;
}
