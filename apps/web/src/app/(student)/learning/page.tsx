import type { Metadata } from "next";
import { MyLearning } from "@/features/platform/student/courses";

export const metadata: Metadata = { title: "My learning", robots: { index: false, follow: false } };

export default function Page() {
  return <MyLearning />;
}
