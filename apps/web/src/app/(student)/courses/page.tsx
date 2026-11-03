import type { Metadata } from "next";
import { Suspense } from "react";
import { CourseCatalog } from "@/features/platform/student/courses";

export const metadata: Metadata = { title: "Browse courses", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <CourseCatalog />
    </Suspense>
  );
}
