"use client";

import { feedbackCategories } from "@ieltiva/shared";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Info, MessageSquarePlus, Play } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiRequestError } from "@/lib/api-client";
import { API_BASE } from "@/lib/download";
import { useApiAction } from "../platform/hooks";
import { FormDialog, SelectBox, TextAreaField } from "../platform/ui";

export type ReleaseState = { channel: string; betaRequired: boolean; maintenanceMessage: string | null; flags: Record<string, boolean> };

export function useReleaseState() {
  return useQuery({ queryKey: ["/release/state"], queryFn: () => api.get<ReleaseState>("/release/state"), staleTime: 60_000, retry: false });
}

/** A hidden link only tidies the screen, because the server stops the feature itself when its switch is off. A switch reads as on until told otherwise. */
export function useFlag(key: string) {
  const { data } = useReleaseState();
  return data?.flags[key] !== false;
}

export function ReleaseBanner() {
  const t = useTranslations("release");
  const { data } = useReleaseState();
  if (!data) return null;
  return (
    <div className="mb-4 space-y-2 empty:hidden">
      {data.maintenanceMessage && <p role="status" className="bg-card flex items-start gap-2 rounded-xl border p-3 text-sm"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {data.maintenanceMessage}</p>}
      {data.channel === "beta" && <p className="bg-card text-muted-foreground flex items-start gap-2 rounded-xl border p-3 text-sm"><FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("betaNotice")}</p>}
    </div>
  );
}

export function FeedbackButton() {
  const t = useTranslations("release.feedback");
  const pathname = usePathname();
  const enabled = useFlag("feedback.collection");
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("BUG");
  const [message, setMessage] = useState("");
  const send = useApiAction(() => api.post("/feedback", { category, message, page: pathname }), t("thanks"));
  if (!enabled) return null;
  return (
    <div className="mt-10 flex justify-center">
      <FormDialog open={open} onOpenChange={setOpen} title={t("title")} description={t("intro")} trigger={<Button variant="ghost" size="sm"><MessageSquarePlus aria-hidden /> {t("button")}</Button>}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate(undefined, {
              onSuccess: () => {
                setOpen(false);
                setMessage("");
              },
            });
          }}
        >
          <SelectBox label={t("kind")} value={category} onChange={(event) => setCategory(event.target.value)} options={feedbackCategories.map((value) => ({ value, label: t(`categories.${value}`) }))} />
          <TextAreaField label={t("message")} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} minLength={5} maxLength={4000} required />
          <p className="text-muted-foreground text-sm">{t("privacy")}</p>
          <Button type="submit" disabled={send.isPending || message.trim().length < 5}>{t("send")}</Button>
        </form>
      </FormDialog>
    </div>
  );
}

/** Plays a private recording. It loads only when asked for, and goes through the signed-in API. */
export function PrivateAudio({ path, label }: { path: string; label: string }) {
  const t = useTranslations("release");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = useRef<string | null>(null);
  useEffect(() => () => {
    if (current.current) URL.revokeObjectURL(current.current);
  }, []);

  async function load() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(`${API_BASE}${path}`, { credentials: "include" });
      if (!response.ok) throw new ApiRequestError(response.status, "UNKNOWN_ERROR", "unavailable");
      const objectUrl = URL.createObjectURL(await response.blob());
      current.current = objectUrl;
      setUrl(objectUrl);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (url) return <audio controls src={url} className="w-full" aria-label={label} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void load()}><Play aria-hidden /> {busy ? t("loadingAudio") : label}</Button>
      {error && <span role="alert" className="text-destructive text-sm">{t("audioUnavailable")}</span>}
    </div>
  );
}
