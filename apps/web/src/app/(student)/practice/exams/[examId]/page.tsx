import type { Metadata } from "next";
import { ExamDetailPage } from "@/features/exam/pages";

export const metadata: Metadata = { title: "Exam", robots: { index: false, follow: false } };

export default function Page() {
  return <ExamDetailPage />;
}
