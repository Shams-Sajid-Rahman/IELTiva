import type { Metadata } from "next";
import { UserDetailPage } from "@/features/platform/admin/users";

export const metadata: Metadata = { title: "User", robots: { index: false, follow: false } };

export default function Page() {
  return <UserDetailPage />;
}
