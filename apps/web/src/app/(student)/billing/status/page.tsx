import type { Metadata } from "next";
import { PaymentStatusPage } from "@/features/billing/student";

export const metadata: Metadata = { title: "Payment status", robots: { index: false, follow: false } };

export default function Page() {
  return <PaymentStatusPage />;
}
