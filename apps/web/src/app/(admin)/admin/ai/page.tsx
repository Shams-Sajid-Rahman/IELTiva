import type { Metadata } from "next";
import { AiUsagePage } from "@/features/platform/admin/ai";

export const metadata: Metadata = { title: "AI usage", robots: { index: false, follow: false } };

export default function Page() {
  return <AiUsagePage />;
}
