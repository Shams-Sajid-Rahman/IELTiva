import type { Metadata } from "next";
import { ReleaseControlsPage } from "@/features/release/admin";

export const metadata: Metadata = { title: "Release controls", robots: { index: false, follow: false } };

export default function Page() {
  return <ReleaseControlsPage />;
}
