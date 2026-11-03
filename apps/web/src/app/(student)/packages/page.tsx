import type { Metadata } from "next";
import { PackagesPage } from "@/features/billing/student";

export const metadata: Metadata = { title: "Packages", robots: { index: false, follow: false } };

export default function Page() {
  return <PackagesPage />;
}
