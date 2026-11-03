import type { Metadata } from "next";
import { PracticeHistoryPage } from "@/features/exam/pages";

export const metadata: Metadata = { title: "Practice history", robots: { index: false, follow: false } };

export default function Page() {
  return <PracticeHistoryPage />;
}
