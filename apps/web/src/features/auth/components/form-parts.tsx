"use client";

import { AlertCircle, CheckCircle2, Circle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldProps = ComponentProps<typeof Input> & { label: string; error?: string; hint?: ReactNode };

export function TextField({ label, error, hint, id, ...props }: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const errorId = `${inputId}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input id={inputId} className="h-11" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} {...props} />
      {hint}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-destructive text-sm" role="alert">
      {children}
    </p>
  );
}

export function PasswordField({ label, error, hint, id, ...props }: FieldProps) {
  const t = useTranslations("auth");
  const generated = useId();
  const inputId = id ?? generated;
  const errorId = `${inputId}-error`;
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="relative">
        <Input
          id={inputId}
          type={visible ? "text" : "password"}
          className="h-11 pr-11"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          {...props}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1 right-1 size-9"
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      </div>
      {hint}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

export function PasswordChecklist({ value }: { value: string }) {
  const t = useTranslations("auth");
  const rules = [
    { label: t("ruleLength"), met: value.length >= 10 },
    { label: t("ruleLower"), met: /[a-z]/.test(value) },
    { label: t("ruleUpper"), met: /[A-Z]/.test(value) },
    { label: t("ruleNumber"), met: /[0-9]/.test(value) },
  ];
  return (
    <ul className="grid gap-1 text-sm sm:grid-cols-2" aria-label={t("passwordRules")}>
      {rules.map(({ label, met }) => (
        <li key={label} className={cn("flex items-center gap-1.5", met ? "text-success" : "text-muted-foreground")}>
          {met ? <CheckCircle2 className="size-4 shrink-0" aria-hidden /> : <Circle className="size-4 shrink-0" aria-hidden />}
          <span>
            {label}
            {met && <span className="sr-only"> {t("ruleMet")}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button type="submit" size="lg" className="h-11 w-full" disabled={pending} aria-busy={pending}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

export function AuthHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="mb-7">
      <h1 className="text-3xl font-medium sm:text-4xl">{title}</h1>
      {description && <p className="text-muted-foreground mt-2 leading-relaxed">{description}</p>}
    </header>
  );
}
