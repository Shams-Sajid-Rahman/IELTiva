import type { Metadata } from "next";
import { AdminGatewaysPage } from "@/features/billing/admin";

export const metadata: Metadata = { title: "Payment gateways", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminGatewaysPage />;
}
