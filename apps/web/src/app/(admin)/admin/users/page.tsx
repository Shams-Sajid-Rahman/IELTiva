import type { Metadata } from "next";
import { UserList } from "@/features/platform/admin/users";

export const metadata: Metadata = { title: "Users", robots: { index: false, follow: false } };

export default function Page() {
  return <UserList />;
}
