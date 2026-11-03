import type { Metadata } from "next";
import { StudentDashboard } from "@/features/platform/student/dashboard";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false, follow: false } };

export default function Page() {
  return <StudentDashboard />;
}
