import type { Metadata } from "next";
import { AttemptResultPage } from "@/features/exam/pages";

export const metadata: Metadata = { title: "Result", robots: { index: false, follow: false } };

export default function Page() {
  return <AttemptResultPage />;
}
