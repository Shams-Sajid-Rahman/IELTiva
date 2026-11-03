import type { Metadata } from "next";
import { PackageDetailPage } from "@/features/billing/student";

export const metadata: Metadata = { title: "Package", robots: { index: false, follow: false } };

export default function Page() {
  return <PackageDetailPage />;
}
