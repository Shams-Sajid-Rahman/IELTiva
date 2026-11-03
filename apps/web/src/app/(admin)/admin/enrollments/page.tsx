import type { Metadata } from "next";
import { EnrollmentsPage } from "@/features/platform/admin/operations";

export const metadata: Metadata = { title: "Enrollments", robots: { index: false, follow: false } };

export default function Page() {
  return <EnrollmentsPage />;
}
