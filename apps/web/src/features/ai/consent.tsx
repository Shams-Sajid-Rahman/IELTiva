"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApiAction, useApiQuery } from "@/features/platform/hooks";
import { ConfirmButton, QueryBoundary } from "@/features/platform/ui";
import { api } from "@/lib/api-client";

export type ConsentType = "AI_PROCESSING" | "SPEECH_PROCESSING" | "CALIBRATION_USE";
export type ConsentState = {
  version: string;
  consents: { type: ConsentType; version: string; grantedAt: string; revokedAt: string | null }[];
  recordingRetentionDays: number;
  aiAvailable: boolean;
  tutorAvailable: boolean;
  speechAvailable: boolean;
};

const has = (state: ConsentState | undefined, type: ConsentType) => Boolean(state?.consents.some((row) => row.type === type && !row.revokedAt));

export function useConsents() {
  const query = useApiQuery<ConsentState>("/consents");
  return { ...query, hasConsent: (types: ConsentType[]) => types.every((type) => has(query.data, type)) };
}

/** Asks clearly, before any of the student's work goes to an AI or speech service. */
export function ConsentButton({ types, label, onReady, disabled, variant = "default" }: { types: ConsentType[]; label: ReactNode; onReady: () => void; disabled?: boolean; variant?: "default" | "outline" }) {
  const t = useTranslations("ai.consent");
  const { hasConsent, data } = useConsents();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function agree() {
    setBusy(true);
    try {
      for (const type of types) await api.put("/consents", { type, granted: true });
      await client.invalidateQueries({ queryKey: ["/consents"] });
      setOpen(false);
      onReady();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} disabled={disabled} onClick={() => (hasConsent(types) ? onReady() : setOpen(true))}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("intro")}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
            {types.includes("AI_PROCESSING") && <li>{t("aiPoint")}</li>}
            {types.includes("SPEECH_PROCESSING") && <li>{t("speechPoint")}</li>}
            {types.includes("SPEECH_PROCESSING") && <li>{t("retentionPoint", { days: data?.recordingRetentionDays ?? 90 })}</li>}
            <li>{t("withdrawPoint")}</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("notNow")}</Button>
            <Button disabled={busy} onClick={() => void agree()}>{t("agree")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PrivacyTab() {
  const t = useTranslations("ai.privacy");
  const query = useConsents();
  const save = useApiAction(({ type, granted }: { type: ConsentType; granted: boolean }) => api.put<{ recordingsDeleted: number }>("/consents", { type, granted }), t("saved"));
  return (
    <QueryBoundary query={query}>
      {(state) => {
        const rows: { type: ConsentType; title: string; body: string }[] = [
          { type: "AI_PROCESSING", title: t("aiTitle"), body: t("aiBody") },
          { type: "CALIBRATION_USE", title: t("calibrationTitle"), body: t("calibrationBody") },
        ];
        const speechOn = has(state, "SPEECH_PROCESSING");
        return (
          <div className="space-y-5">
            <p className="text-muted-foreground flex items-start gap-2 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("intro")}</p>
            {rows.map((row) => (
              <div key={row.type} className="flex items-center justify-between gap-4 rounded-xl border p-4">
                <div>
                  <Label htmlFor={`consent-${row.type}`}>{row.title}</Label>
                  <p className="text-muted-foreground text-sm">{row.body}</p>
                </div>
                <Switch id={`consent-${row.type}`} checked={has(state, row.type)} disabled={save.isPending} onCheckedChange={(granted) => save.mutate({ type: row.type, granted })} />
              </div>
            ))}
            <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">{t("speechTitle")}</p>
                <p className="text-muted-foreground text-sm">{t("speechBody", { days: state.recordingRetentionDays })}</p>
              </div>
              {speechOn ? (
                <ConfirmButton label={t("withdraw")} title={t("withdrawTitle")} description={t("withdrawBody")} destructive onConfirm={() => save.mutate({ type: "SPEECH_PROCESSING", granted: false })} />
              ) : (
                <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => save.mutate({ type: "SPEECH_PROCESSING", granted: true })}>{t("allow")}</Button>
              )}
            </div>
          </div>
        );
      }}
    </QueryBoundary>
  );
}
