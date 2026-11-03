import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/components/login-form";
import { GuestOnly } from "@/features/auth/route-guards";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense>
      <GuestOnly>
        <LoginForm />
      </GuestOnly>
    </Suspense>
  );
}
