"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { passwordSchema } from "@ieltiva/shared";
import { CheckCircle2, LinkIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { api, ApiRequestError } from "@/lib/api-client";
import { useAuth } from "../auth-provider";
import { AuthHeading, FormAlert, PasswordChecklist, PasswordField, SubmitButton } from "./form-parts";

const formSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string().min(1, "Confirm your password.") })
  .refine((data) => data.password === data.confirmPassword, { path: ["confirmPassword"], message: "Passwords don't match." });

export function ResetPasswordForm() {
  const t = useTranslations("auth");
  const token = useSearchParams().get("token");
  const { refreshUser } = useAuth();
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, control, formState } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const password = useWatch({ control, name: "password" });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post("/auth/reset-password", { token, ...values }, { skipRefresh: true });
      setDone(true);
      void refreshUser(); // The reset ended every session, so this updates the signed-in state.
    } catch (error) {
      setFormError(error instanceof ApiRequestError ? error.message : t("genericError"));
    }
  });

  const requestAgain = (
    <Button asChild>
      <Link href="/forgot-password">{t("requestNewLink")}</Link>
    </Button>
  );

  if (!token) return <EmptyState headingLevel={1} icon={<LinkIcon aria-hidden />} title={t("linkInvalidTitle")} description={t("linkInvalidBody")} action={requestAgain} />;

  if (done) {
    return (
      <EmptyState headingLevel={1}
        icon={<CheckCircle2 aria-hidden />}
        title={t("resetDoneTitle")}
        description={t("resetDoneBody")}
        action={
          <Button asChild>
            <Link href="/login">{t("signIn")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <AuthHeading title={t("resetTitle")} description={t("resetBody")} />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && (
          <FormAlert>
            {formError} <Link href="/forgot-password" className="underline">{t("requestNewLink")}</Link>
          </FormAlert>
        )}
        <PasswordField label={t("newPassword")} autoComplete="new-password" error={formState.errors.password?.message} hint={<PasswordChecklist value={password} />} {...register("password")} />
        <PasswordField label={t("confirmPassword")} autoComplete="new-password" error={formState.errors.confirmPassword?.message} {...register("confirmPassword")} />
        <SubmitButton pending={formState.isSubmitting}>{t("resetSubmit")}</SubmitButton>
      </form>
    </>
  );
}
