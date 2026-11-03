import type { Metadata } from "next";
import { CoursesAdminPage } from "@/features/platform/admin/content";

export const metadata: Metadata = { title: "Courses", robots: { index: false, follow: false } };

export default function Page() {
  return <CoursesAdminPage />;
}
