import type { Metadata } from "next";
import { PlannerPage } from "@/features/platform/student/account";

export const metadata: Metadata = { title: "Study planner", robots: { index: false, follow: false } };

export default function Page() {
  return <PlannerPage />;
}
