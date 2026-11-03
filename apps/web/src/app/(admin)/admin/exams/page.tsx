import type { Metadata } from "next";
import { ExamsAdminPage } from "@/features/platform/admin/exams";

export const metadata: Metadata = { title: "Exams", robots: { index: false, follow: false } };

export default function Page() {
  return <ExamsAdminPage />;
}
