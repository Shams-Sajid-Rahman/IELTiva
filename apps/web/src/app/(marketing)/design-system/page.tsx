import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignSystemShowcase } from "./showcase";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

// Internal reference page: available in development, and in production only when explicitly enabled.
export default function DesignSystemPage() {
  const enabled = process.env.NODE_ENV !== "production" || process.env.DESIGN_SYSTEM_ENABLED === "true";
  if (!enabled) notFound();
  return <DesignSystemShowcase />;
}
