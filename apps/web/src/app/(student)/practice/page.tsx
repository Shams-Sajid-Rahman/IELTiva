import type { Metadata } from "next";
import { PracticeOverview } from "@/features/platform/student/courses";

export const metadata: Metadata = { title: "IELTS practice", robots: { index: false, follow: false } };

export default function Page() {
  return <PracticeOverview />;
}
