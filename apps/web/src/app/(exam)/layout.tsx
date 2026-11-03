import type { ReactNode } from "react";
import { RequireAuth } from "@/features/auth/route-guards";

/** No site navigation here, so nothing competes for attention during an exam. */
export default function Layout({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
