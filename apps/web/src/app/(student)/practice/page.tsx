import type { Metadata } from "next";
import { Suspense } from "react";
import { PracticeHome } from "@/features/exam/pages";

export const metadata: Metadata = { title: "IELTS practice", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <PracticeHome />
    </Suspense>
  );
}
