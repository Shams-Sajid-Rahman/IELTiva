import type { Metadata } from "next";
import { RolesPage } from "@/features/platform/admin/users";

export const metadata: Metadata = { title: "Roles and permissions", robots: { index: false, follow: false } };

export default function Page() {
  return <RolesPage />;
}
