import type { Metadata } from "next";
import { CourseDetailView } from "@/features/platform/student/courses";

export const metadata: Metadata = { title: "Course", robots: { index: false, follow: false } };

export default function Page() {
  return <CourseDetailView />;
}
