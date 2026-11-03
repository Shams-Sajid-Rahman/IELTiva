import type { Metadata } from "next";
import { AttemptPlayer } from "@/features/exam/player";

export const metadata: Metadata = { title: "Exam", robots: { index: false, follow: false } };

export default function Page() {
  return <AttemptPlayer />;
}
