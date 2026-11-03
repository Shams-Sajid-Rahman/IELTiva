import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/features/auth/components/register-form";
import { GuestOnly } from "@/features/auth/route-guards";

export const metadata: Metadata = { title: "Create your account" };

export default function RegisterPage() {
  return (
    <Suspense>
      <GuestOnly>
        <RegisterForm />
      </GuestOnly>
    </Suspense>
  );
}
