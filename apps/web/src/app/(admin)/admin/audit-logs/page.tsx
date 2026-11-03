import type { Metadata } from "next";
import { AuditLogsPage } from "@/features/platform/admin/operations";

export const metadata: Metadata = { title: "Audit logs", robots: { index: false, follow: false } };

export default function Page() {
  return <AuditLogsPage />;
}
