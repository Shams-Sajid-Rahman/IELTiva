import type { ReactNode } from "react";
import { AdminLayout } from "@/features/platform/admin-nav";

export default function Layout({ children }: { children: ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}
