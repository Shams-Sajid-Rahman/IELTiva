"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { emailSchema } from "@ieltiva/shared";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { api, ApiRequestError } from "@/lib/api-client";
import { FormAlert, SubmitButton, TextField } from "./form-parts";

/** The confirmation is the same whether or not the account exists, and doesn't claim an email was sent. */
export function EmailRequestForm({ path, submitLabel, doneTitle, doneBody }: { path: string; submitLabel: string; doneTitle: string; doneBody: string }) {
  const t = useTranslations("auth");
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ email: string }>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post(path, values, { skipRefresh: true });
      setDone(true);
    } catch (error) {
      setFormError(error instanceof ApiRequestError ? error.message : t("genericError"));
    }
  });

  if (done) {
    return (
      <EmptyState
        icon={<MailCheck aria-hidden />}
        title={doneTitle}
        description={doneBody}
        action={
          <Button asChild variant="outline">
            <Link href="/login">{t("backToSignIn")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <FormAlert>{formError}</FormAlert>}
      <TextField label={t("email")} type="email" autoComplete="email" error={formState.errors.email?.message} {...register("email")} />
      <SubmitButton pending={formState.isSubmitting}>{submitLabel}</SubmitButton>
      <p className="text-center text-sm">
        <Link href="/login" className="text-primary font-medium underline-offset-4 hover:underline">
          {t("backToSignIn")}
        </Link>
      </p>
    </form>
  );
}
