import type { Metadata } from "next";
import { AdminPaymentsPage } from "@/features/billing/admin";

export const metadata: Metadata = { title: "Payments", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminPaymentsPage />;
}
