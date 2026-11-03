import type { Metadata } from "next";
import { ProfilePage } from "@/features/platform/student/account";

export const metadata: Metadata = { title: "My profile", robots: { index: false, follow: false } };

export default function Page() {
  return <ProfilePage />;
}
