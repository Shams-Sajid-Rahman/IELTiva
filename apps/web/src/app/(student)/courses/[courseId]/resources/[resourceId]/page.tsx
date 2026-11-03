import type { Metadata } from "next";
import { ResourceViewPage } from "@/features/platform/student/courses";

export const metadata: Metadata = { title: "Lesson", robots: { index: false, follow: false } };

export default function Page() {
  return <ResourceViewPage />;
}
