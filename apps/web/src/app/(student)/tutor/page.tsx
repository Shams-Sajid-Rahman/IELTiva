import type { Metadata } from "next";
import { TutorPage } from "@/features/ai/tutor";

export const metadata: Metadata = { title: "AI tutor", robots: { index: false, follow: false } };

export default function Page() {
  return <TutorPage />;
}
