import type { Metadata } from "next";
import { CalibrationPage } from "@/features/platform/admin/ai";

export const metadata: Metadata = { title: "Human calibration", robots: { index: false, follow: false } };

export default function Page() {
  return <CalibrationPage />;
}
