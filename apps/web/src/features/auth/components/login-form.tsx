"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@ieltiva/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { ApiRequestError } from "@/lib/api-client";
import { useAuth } from "../auth-provider";
import { safeNextPath } from "../navigation";
import { AuthHeading, FormAlert, PasswordField, SubmitButton, TextField } from "./form-parts";
import { GoogleButton } from "./google-button";

export function LoginForm() {
  const t = useTranslations("auth");
  const { login } = useAuth();
  const next = safeNextPath(useSearchParams().get("next"));
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values); // GuestOnly redirects once the user is set.
    } catch (error) {
      setFormError(error instanceof ApiRequestError ? error.message : t("genericError"));
    }
  });

  return (
    <>
      <AuthHeading title={t("loginTitle")} description={t("loginBody")} />
      <GoogleButton />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <FormAlert>{formError}</FormAlert>}
        <TextField label={t("email")} type="email" autoComplete="email" error={formState.errors.email?.message} {...register("email")} />
        <PasswordField label={t("password")} autoComplete="current-password" error={formState.errors.password?.message} {...register("password")} />
        <div className="text-right">
          <Link href="/forgot-password" className="text-primary text-sm font-medium underline-offset-4 hover:underline">
            {t("forgotLink")}
          </Link>
        </div>
        <SubmitButton pending={formState.isSubmitting}>{formState.isSubmitting ? t("signingIn") : t("signIn")}</SubmitButton>
      </form>
      <p className="text-muted-foreground mt-6 text-center text-sm">
        {t("noAccount")}{" "}
        <Link href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"} className="text-primary font-medium underline-offset-4 hover:underline">
          {t("createAccount")}
        </Link>
      </p>
    </>
  );
}
