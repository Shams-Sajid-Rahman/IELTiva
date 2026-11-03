import type { Metadata } from "next";
import { CourseEditor } from "@/features/platform/admin/content";

export const metadata: Metadata = { title: "Manage course", robots: { index: false, follow: false } };

export default function Page() {
  return <CourseEditor />;
}
