import type { Metadata } from "next";
import { ExamEditorPage } from "@/features/platform/admin/exams";

export const metadata: Metadata = { title: "Edit exam", robots: { index: false, follow: false } };

export default function Page() {
  return <ExamEditorPage />;
}
