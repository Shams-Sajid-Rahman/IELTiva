"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema } from "@ieltiva/shared";
import { MailCheck, MailWarning } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Controller, useForm, useWatch, type FieldPath } from "react-hook-form";
import type { z } from "zod";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ApiRequestError } from "@/lib/api-client";
import { useAuth } from "../auth-provider";
import { AuthHeading, FieldError, FormAlert, PasswordChecklist, PasswordField, SubmitButton, TextField } from "./form-parts";
import { GoogleButton } from "./google-button";

type FormInput = z.input<typeof registerSchema>;
type FormOutput = z.output<typeof registerSchema>;

export function RegisterForm() {
  const t = useTranslations("auth");
  const { register: createAccount } = useAuth();
  const termsId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; delivered: boolean } | null>(null);
  const { register, handleSubmit, control, setError, formState } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", email: "", password: "", confirmPassword: "", termsAccepted: false as unknown as true },
  });
  const password = useWatch({ control, name: "password" });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await createAccount(values);
      setCreated({ email: values.email, delivered: result.verificationEmailDelivered });
    } catch (error) {
      if (!(error instanceof ApiRequestError)) {
        setFormError(t("genericError"));
        return;
      }
      if (error.code === "CONFLICT") {
        setError("email", { message: error.message });
        return;
      }
      error.fieldErrors.forEach(({ path, message }) => setError(path as FieldPath<FormInput>, { message }));
      if (error.fieldErrors.length === 0) setFormError(error.message);
    }
  });

  if (created) {
    return (
      <EmptyState headingLevel={1}
        icon={created.delivered ? <MailCheck aria-hidden /> : <MailWarning aria-hidden />}
        title={created.delivered ? t("checkEmailTitle") : t("accountCreatedTitle")}
        description={created.delivered ? t("checkEmailBody", { email: created.email }) : t("emailNotDeliveredBody")}
        action={
          <div className="flex flex-col gap-2">
            <Button asChild>
              <Link href="/login">{t("signIn")}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/verify-email">{t("resendLink")}</Link>
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <>
      <AuthHeading title={t("registerTitle")} description={t("registerBody")} />
      <GoogleButton />
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <FormAlert>{formError}</FormAlert>}
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label={t("firstName")} autoComplete="given-name" error={errors.firstName?.message} {...register("firstName")} />
          <TextField label={t("lastName")} autoComplete="family-name" error={errors.lastName?.message} {...register("lastName")} />
        </div>
        <TextField label={t("email")} type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
        <PasswordField
          label={t("password")}
          autoComplete="new-password"
          error={errors.password?.message}
          hint={<PasswordChecklist value={password} />}
          {...register("password")}
        />
        <PasswordField label={t("confirmPassword")} autoComplete="new-password" error={errors.confirmPassword?.message} {...register("confirmPassword")} />
        <div>
          <div className="flex items-start gap-2.5">
            <Controller
              control={control}
              name="termsAccepted"
              render={({ field }) => (
                <Checkbox
                  id={termsId}
                  ref={field.ref}
                  className="mt-0.5"
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  onBlur={field.onBlur}
                  aria-invalid={Boolean(errors.termsAccepted)}
                  aria-describedby={errors.termsAccepted ? `${termsId}-error` : undefined}
                />
              )}
            />
            <Label htmlFor={termsId} className="leading-snug font-normal">
              {t("acceptTerms")}
            </Label>
          </div>
          {errors.termsAccepted?.message && (
            <div className="mt-2">
              <FieldError id={`${termsId}-error`}>{errors.termsAccepted.message}</FieldError>
            </div>
          )}
        </div>
        <SubmitButton pending={isSubmitting}>{isSubmitting ? t("creatingAccount") : t("createAccount")}</SubmitButton>
      </form>
      <p className="text-muted-foreground mt-6 text-center text-sm">
        {t("haveAccount")}{" "}
        <Link href="/login" className="text-primary font-medium underline-offset-4 hover:underline">
          {t("signIn")}
        </Link>
      </p>
    </>
  );
}
