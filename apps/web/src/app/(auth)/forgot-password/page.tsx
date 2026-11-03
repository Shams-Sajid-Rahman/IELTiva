import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthHeading } from "@/features/auth/components/form-parts";
import { EmailRequestForm } from "@/features/auth/components/email-request-form";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth");
  return (
    <>
      <AuthHeading title={t("forgotTitle")} description={t("forgotBody")} />
      <EmailRequestForm path="/auth/forgot-password" submitLabel={t("forgotSubmit")} doneTitle={t("requestDoneTitle")} doneBody={t("forgotDoneBody")} />
    </>
  );
}
