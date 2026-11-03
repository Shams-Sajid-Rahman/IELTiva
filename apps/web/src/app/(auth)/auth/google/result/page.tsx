import type { Metadata } from "next";
import { Suspense } from "react";
import { GoogleResultView } from "@/features/auth/components/google-result-view";

export const metadata: Metadata = { title: "Google sign-in" };

export default function GoogleResultPage() {
  return (
    <Suspense>
      <GoogleResultView />
    </Suspense>
  );
}
