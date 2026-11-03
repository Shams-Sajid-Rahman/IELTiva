"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bot, MessageSquarePlus, Send, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApiAction, useApiPage, useApiQuery } from "@/features/platform/hooks";
import { ConfirmButton, Empty, PageHeader, QueryBoundary } from "@/features/platform/ui";
import { api, ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { ConsentButton, useConsents } from "./consent";

type Conversation = { id: string; title: string | null; updatedAt: string };
type Message = { id: string; role: "user" | "assistant"; text: string };
type Full = { id: string; title: string | null; messages: Message[] };

const STARTERS = ["starter1", "starter2", "starter3", "starter4"] as const;

function Chat({ conversationId, onFirstMessage }: { conversationId: string | null; onFirstMessage: (message: string) => Promise<string> }) {
  const t = useTranslations("ai.tutor");
  const client = useQueryClient();
  const query = useApiQuery<Full>(`/tutor/conversations/${conversationId}`, { enabled: Boolean(conversationId) });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ user: string; reply: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const messages = conversationId ? (query.data?.messages ?? []) : [];

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending?.reply]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setDraft("");
    setError(null);
    setPending({ user: message, reply: "" });
    try {
      const id = conversationId ?? (await onFirstMessage(message));
      await api.stream(`/tutor/conversations/${id}/messages`, { message }, (chunk) => setPending((current) => (current ? { ...current, reply: current.reply + chunk } : current)));
      await Promise.all([client.invalidateQueries({ queryKey: [`/tutor/conversations/${id}`] }), client.invalidateQueries({ predicate: (entry) => String(entry.queryKey[0]).startsWith("/tutor/conversations?") })]);
    } catch (caught) {
      setDraft(message);
      setError(caught instanceof ApiRequestError ? caught.message : t("failed"));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="bg-card shadow-soft flex min-h-[60dvh] min-w-0 flex-1 flex-col rounded-xl border lg:h-[calc(100dvh-13rem)] lg:min-h-0">
      <div tabIndex={0} role="log" aria-label={t("conversation")} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        {messages.length === 0 && !pending && (
          <div className="mx-auto max-w-lg py-6 text-center">
            <Bot className="text-primary mx-auto size-8" aria-hidden />
            <p className="mt-3 font-medium">{t("welcome")}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {STARTERS.map((key) => <button key={key} type="button" onClick={() => void send(t(key))} className="lift bg-background rounded-lg border p-3 text-left text-sm">{t(key)}</button>)}
            </div>
          </div>
        )}
        {messages.map((message) => <Bubble key={message.id} role={message.role} text={message.text} />)}
        {pending && <><Bubble role="user" text={pending.user} /><Bubble role="assistant" text={pending.reply || t("thinking")} muted={!pending.reply} /></>}
        <div ref={bottom} />
      </div>
      <form className="border-t p-3 sm:p-4" onSubmit={(event) => { event.preventDefault(); void send(draft); }}>
        {error && <p role="alert" className="text-destructive mb-2 text-sm">{error}</p>}
        <Label htmlFor="tutor-input" className="sr-only">{t("inputLabel")}</Label>
        <div className="flex items-end gap-2">
          <Textarea id="tutor-input" rows={2} value={draft} placeholder={t("placeholder")} maxLength={8000} className="min-h-11 flex-1 resize-none" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }} />
          <Button type="submit" size="icon" aria-label={t("send")} disabled={!draft.trim() || Boolean(pending)}><Send aria-hidden /></Button>
        </div>
        <p className="text-muted-foreground mt-2 text-xs">{t("disclaimer")}</p>
      </form>
    </div>
  );
}

function Bubble({ role, text, muted }: { role: string; text: string; muted?: boolean }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <p className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap", role === "user" ? "bg-primary text-primary-foreground" : "bg-muted", muted && "text-muted-foreground")}>{text}</p>
    </div>
  );
}

export function TutorPage() {
  const t = useTranslations("ai.tutor");
  const consents = useConsents();
  const [selected, setSelected] = useState<string | null>(null);
  const list = useApiPage<Conversation>("/tutor/conversations", { pageSize: 50 });
  const remove = useApiAction((id: string) => api.delete(`/tutor/conversations/${id}`), t("deleted"));
  const [ready, setReady] = useState(false);
  const allowed = consents.hasConsent(["AI_PROCESSING"]) || ready;

  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <QueryBoundary query={consents}>
        {(state) =>
          !state.tutorAvailable ? (
            <Empty icon={<Bot aria-hidden />} title={t("unavailableTitle")} description={t("unavailableBody")} />
          ) : !allowed ? (
            <Empty icon={<Bot aria-hidden />} title={t("consentTitle")} description={t("consentBody")} action={<ConsentButton types={["AI_PROCESSING"]} label={t("start")} onReady={() => setReady(true)} />} />
          ) : (
            <div className="flex flex-col gap-4 lg:flex-row">
              <aside className="shrink-0 lg:w-64">
                <Button variant="outline" className="w-full" onClick={() => setSelected(null)}><MessageSquarePlus aria-hidden /> {t("newChat")}</Button>
                <QueryBoundary query={list}>
                  {({ items }) => (
                    <ul aria-label={t("history")} className="mt-3 max-h-48 space-y-1 overflow-y-auto lg:max-h-[calc(100dvh-17rem)]">
                      {items.map((row) => (
                        <li key={row.id} className="flex items-center gap-1">
                          <button type="button" aria-current={selected === row.id ? "true" : undefined} onClick={() => setSelected(row.id)} className={cn("min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm transition-colors", selected === row.id ? "bg-accent text-accent-foreground font-medium" : "hover:bg-muted")}>{row.title ?? t("untitled")}</button>
                          <ConfirmButton variant="ghost" label={<><Trash2 aria-hidden /><span className="sr-only">{t("deleteChat", { title: row.title ?? t("untitled") })}</span></>} title={t("deleteTitle")} description={t("deleteBody")} destructive onConfirm={() => { remove.mutate(row.id); if (selected === row.id) setSelected(null); }} />
                        </li>
                      ))}
                    </ul>
                  )}
                </QueryBoundary>
              </aside>
              <Chat
                key={selected ?? "new"}
                conversationId={selected}
                onFirstMessage={async () => {
                  const created = await api.post<{ id: string }>("/tutor/conversations");
                  return created.id;
                }}
              />
            </div>
          )
        }
      </QueryBoundary>
    </>
  );
}
