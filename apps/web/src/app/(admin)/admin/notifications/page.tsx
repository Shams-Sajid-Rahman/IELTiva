import type { Metadata } from "next";
import { AnnouncementsPage } from "@/features/platform/admin/operations";

export const metadata: Metadata = { title: "Announcements", robots: { index: false, follow: false } };

export default function Page() {
  return <AnnouncementsPage />;
}
