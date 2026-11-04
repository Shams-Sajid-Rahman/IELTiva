import type { Metadata } from "next";
import { AssessmentReviewPage } from "@/features/platform/admin/assessments";

export const metadata: Metadata = { title: "Instructor reviews", robots: { index: false, follow: false } };

export default function Page() {
  return <AssessmentReviewPage />;
}
