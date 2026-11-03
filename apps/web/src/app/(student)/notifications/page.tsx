import type { Metadata } from "next";
import { NotificationCenter } from "@/features/platform/student/account";

export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };

export default function Page() {
  return <NotificationCenter />;
}
