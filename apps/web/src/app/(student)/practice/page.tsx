import type { Metadata } from "next";
import { PracticeHome } from "@/features/exam/pages";

export const metadata: Metadata = { title: "IELTS practice", robots: { index: false, follow: false } };

export default function Page() {
  return <PracticeHome />;
}
