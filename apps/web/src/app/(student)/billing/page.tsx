import type { Metadata } from "next";
import { BillingPage } from "@/features/billing/student";

export const metadata: Metadata = { title: "Billing", robots: { index: false, follow: false } };

export default function Page() {
  return <BillingPage />;
}
