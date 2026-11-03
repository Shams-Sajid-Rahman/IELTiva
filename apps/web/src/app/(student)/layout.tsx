import type { ReactNode } from "react";
import { StudentLayout } from "@/features/platform/student-nav";

export default function Layout({ children }: { children: ReactNode }) {
  return <StudentLayout>{children}</StudentLayout>;
}
