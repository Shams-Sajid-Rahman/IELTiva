"use client";

import { incidentSeverities, incidentStatuses } from "@ieltiva/shared";
import { Lock, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/features/auth/auth-provider";
import { api } from "@/lib/api-client";
import { formatDateTime } from "../platform/format";
import { useApiAction, useApiPage, useApiQuery } from "../platform/hooks";
import { ConfirmButton, Empty, FormDialog, InputField, PageHeader, Pagination, QueryBoundary, SelectBox, TableFrame, TextAreaField, tdClass, thClass } from "../platform/ui";

type Overview = {
  channel: string;
  betaRequired: boolean;
  approvalRequired: boolean;
  maintenanceMessage: string | null;
  locked: { betaRequired: boolean; approvalRequired: boolean };
  flagDetails: { key: string; enabled: boolean; defaultOn: boolean; updatedAt: string | null; updatedBy: string | null }[];
  bandReleases: Record<string, number>;
};

function SwitchesTab() {
  const t = useTranslations("release.admin");
  const flags = useTranslations("release.flags");
  const query = useApiQuery<Overview>("/admin/release");
  const setFlag = useApiAction((input: { key: string; enabled: boolean }) => api.put(`/admin/release/flags/${input.key}`, { enabled: input.enabled }), t("saved"));
  const setMessage = useApiAction((message: string | null) => api.put("/admin/release/maintenance", { message }), t("saved"));
  return (
    <QueryBoundary query={query}>
      {(data) => {
        const isLocked = (key: string) => (key === "beta.access_required" && data.locked.betaRequired) || (key === "content.publication_approval" && data.locked.approvalRequired);
        return (
          <div className="space-y-6">
            <div className="bg-card rounded-xl border p-4 text-sm">
              <p className="font-medium">{t("channel", { channel: data.channel })}</p>
              <p className="text-muted-foreground mt-1">{t("channelNote")}</p>
              <p className="mt-2">{t("bandsState", { released: data.bandReleases.PUBLIC ?? 0 })}</p>
            </div>
            <ul className="bg-card shadow-soft divide-y rounded-xl border">
              {data.flagDetails.map((flag) => (
                <li key={flag.key} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-medium">{flags(`${flag.key.replace(/\./g, "_")}.title`)}</p>
                    <p className="text-muted-foreground">{flags(`${flag.key.replace(/\./g, "_")}.body`)}</p>
                    {flag.updatedBy && <p className="text-muted-foreground mt-1 text-xs">{t("changedBy", { who: flag.updatedBy, when: formatDateTime(flag.updatedAt) })}</p>}
                  </div>
                  {isLocked(flag.key) ? (
                    <Badge variant="outline"><Lock aria-hidden /> {t("lockedOn")}</Badge>
                  ) : (
                    <Switch aria-label={flags(`${flag.key.replace(/\./g, "_")}.title`)} checked={flag.enabled} disabled={setFlag.isPending} onCheckedChange={(enabled) => setFlag.mutate({ key: flag.key, enabled })} />
                  )}
                </li>
              ))}
            </ul>
            <form
              className="bg-card shadow-soft space-y-3 rounded-xl border p-4"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                const message = String(new FormData(event.currentTarget).get("message") ?? "").trim();
                setMessage.mutate(message || null);
              }}
            >
              <TextAreaField name="message" label={t("maintenance")} rows={2} maxLength={300} defaultValue={data.maintenanceMessage ?? ""} />
              <p className="text-muted-foreground text-sm">{t("maintenanceHint")}</p>
              <Button type="submit" variant="outline" disabled={setMessage.isPending}>{t("saveMessage")}</Button>
            </form>
          </div>
        );
      }}
    </QueryBoundary>
  );
}

type BetaRow = { id: string; email: string; status: string; note: string | null; createdAt: string };

function BetaTab() {
  const t = useTranslations("release.admin");
  const [page, setPage] = useState(1);
  const query = useApiPage<BetaRow>("/admin/release/beta", { page, pageSize: 20 });
  const add = useApiAction((body: { email: string; note: string | null }) => api.post("/admin/release/beta", body), t("saved"));
  const remove = useApiAction((id: string) => api.delete(`/admin/release/beta/${id}`), t("saved"));
  return (
    <div className="space-y-4">
      <p className="bg-card rounded-xl border p-4 text-sm">{t("betaNote")}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          add.mutate({ email: String(data.get("email")), note: String(data.get("note") ?? "") || null }, { onSuccess: () => form.reset() });
        }}
      >
        <InputField name="email" type="email" label={t("email")} required />
        <InputField name="note" label={t("noteOptional")} />
        <Button type="submit" disabled={add.isPending}><Plus aria-hidden /> {t("allow")}</Button>
      </form>
      <QueryBoundary query={query}>
        {(data) =>
          data.items.length === 0 ? <Empty title={t("noBeta")} /> : (
            <>
              <TableFrame label={t("betaTab")}>
                <thead><tr>{[t("email"), t("status"), t("noteOptional"), ""].map((heading, index) => <th key={`${heading}-${index}`} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td className={`${tdClass} break-all`}>{row.email}</td>
                      <td className={tdClass}><Badge variant={row.status === "ALLOWED" ? "default" : "outline"}>{t(`betaStatus.${row.status}`)}</Badge></td>
                      <td className={tdClass}>{row.note ?? "-"}</td>
                      <td className={tdClass}>{row.status === "ALLOWED" && <ConfirmButton variant="ghost" size="icon" destructive label={<><Trash2 aria-hidden /><span className="sr-only">{t("removeAccess")}</span></>} title={t("removeAccess")} description={t("removeAccessBody")} onConfirm={() => remove.mutate(row.id)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
              <Pagination meta={data.meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </div>
  );
}

type FeedbackRow = { id: string; category: string; message: string; page: string | null; status: string; staffNote: string | null; createdAt: string; user: { email: string } | null };

function FeedbackTab() {
  const t = useTranslations("release.admin");
  const feedback = useTranslations("release.feedback.categories");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("NEW");
  const query = useApiPage<FeedbackRow>("/admin/feedback", { page, pageSize: 20, status });
  const update = useApiAction((input: { id: string; status: string }) => api.patch(`/admin/feedback/${input.id}`, { status: input.status }), t("saved"));
  return (
    <div className="space-y-4">
      <SelectBox label={t("status")} className="w-44" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} options={["NEW", "TRIAGED", "RESOLVED"].map((value) => ({ value, label: t(`feedbackStatus.${value}`) }))} />
      <QueryBoundary query={query}>
        {(data) =>
          data.items.length === 0 ? <Empty title={t("noFeedback")} /> : (
            <>
              <ul className="bg-card shadow-soft divide-y rounded-xl border">
                {data.items.map((row) => (
                  <li key={row.id} className="space-y-2 p-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{feedback(row.category)}</Badge>
                      <span className="text-muted-foreground break-all">{row.user?.email ?? t("deletedUser")} · {formatDateTime(row.createdAt)}{row.page ? ` · ${row.page}` : ""}</span>
                    </div>
                    {/* Shown as plain text, because what people type here is never trusted. */}
                    <p className="break-words whitespace-pre-wrap">{row.message}</p>
                    <div className="flex flex-wrap gap-2">
                      {["TRIAGED", "RESOLVED"].filter((next) => next !== row.status).map((next) => <Button key={next} variant="outline" size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: row.id, status: next })}>{t(`feedbackMove.${next}`)}</Button>)}
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination meta={data.meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </div>
  );
}

type IncidentRow = { id: string; title: string; severity: string; status: string; summary: string; personalDataAffected: boolean; paymentsAffected: boolean; startedAt: string; resolvedAt: string | null; updates: { id: string; body: string; status: string | null; createdAt: string; author: { email: string } | null }[] };

function IncidentCard({ row }: { row: IncidentRow }) {
  const t = useTranslations("release.admin");
  const [open, setOpen] = useState(false);
  const update = useApiAction((body: { body: string; status?: string }) => api.post(`/admin/incidents/${row.id}/updates`, body), t("saved"));
  return (
    <li className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{row.title}</p>
        <Badge variant={row.severity === "CRITICAL" || row.severity === "HIGH" ? "destructive" : "outline"}>{t(`severity.${row.severity}`)}</Badge>
        <Badge variant="outline">{t(`incidentStatus.${row.status}`)}</Badge>
        {row.personalDataAffected && <Badge variant="destructive">{t("personalData")}</Badge>}
        {row.paymentsAffected && <Badge variant="destructive">{t("payments")}</Badge>}
      </div>
      <p className="text-muted-foreground">{formatDateTime(row.startedAt)}{row.resolvedAt ? ` → ${formatDateTime(row.resolvedAt)}` : ""}</p>
      <p className="break-words whitespace-pre-wrap">{row.summary}</p>
      {row.personalDataAffected && row.status !== "RESOLVED" && <p className="text-destructive">{t("personalDataNote")}</p>}
      {row.updates.length > 0 && (
        <ul className="border-l-2 pl-3">
          {row.updates.map((item) => <li key={item.id} className="py-1"><span className="text-muted-foreground">{formatDateTime(item.createdAt)} · {item.author?.email ?? "-"}{item.status ? ` · ${t(`incidentStatus.${item.status}`)}` : ""}</span><p className="break-words whitespace-pre-wrap">{item.body}</p></li>)}
        </ul>
      )}
      <FormDialog open={open} onOpenChange={setOpen} title={t("addUpdate")} trigger={<Button variant="outline" size="sm">{t("addUpdate")}</Button>}>
        <form
          className="space-y-3"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const status = String(data.get("status") ?? "");
            update.mutate({ body: String(data.get("body")), ...(status ? { status } : {}) }, { onSuccess: () => setOpen(false) });
          }}
        >
          <TextAreaField name="body" label={t("whatChanged")} rows={3} required />
          <SelectBox name="status" label={t("status")} options={[{ value: "", label: t("noStatusChange") }, ...incidentStatuses.map((value) => ({ value, label: t(`incidentStatus.${value}`) }))]} />
          <Button type="submit" disabled={update.isPending}>{t("save")}</Button>
        </form>
      </FormDialog>
    </li>
  );
}

function IncidentsTab() {
  const t = useTranslations("release.admin");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const query = useApiPage<IncidentRow>("/admin/incidents", { page, pageSize: 20 });
  const create = useApiAction((body: object) => api.post("/admin/incidents", body), t("saved"));
  return (
    <div className="space-y-4">
      <FormDialog open={open} onOpenChange={setOpen} title={t("newIncident")} description={t("newIncidentHint")} trigger={<Button><ShieldAlert aria-hidden /> {t("newIncident")}</Button>}>
        <form
          className="space-y-3"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            create.mutate({ title: String(data.get("title")), severity: String(data.get("severity")), summary: String(data.get("summary")), personalDataAffected: data.get("personal") === "on", paymentsAffected: data.get("payments") === "on" }, { onSuccess: () => setOpen(false) });
          }}
        >
          <InputField name="title" label={t("incidentTitle")} required />
          <SelectBox name="severity" label={t("severityLabel")} defaultValue="MEDIUM" options={incidentSeverities.map((value) => ({ value, label: t(`severity.${value}`) }))} />
          <TextAreaField name="summary" label={t("whatHappened")} rows={4} required />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="personal" /> {t("personalData")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="payments" /> {t("payments")}</label>
          <Button type="submit" disabled={create.isPending}>{t("save")}</Button>
        </form>
      </FormDialog>
      <QueryBoundary query={query}>
        {(data) =>
          data.items.length === 0 ? <Empty title={t("noIncidents")} /> : (
            <>
              <ul className="bg-card shadow-soft divide-y rounded-xl border">{data.items.map((row) => <IncidentCard key={row.id} row={row} />)}</ul>
              <Pagination meta={data.meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </div>
  );
}

export function ReleaseControlsPage() {
  const t = useTranslations("release.admin");
  const { hasPermission } = useAuth();
  const manage = hasPermission("release.manage");
  const support = hasPermission("support.manage");
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <Tabs defaultValue={manage ? "switches" : "feedback"}>
        <TabsList className="w-full sm:w-fit">
          {manage && <TabsTrigger value="switches">{t("switchesTab")}</TabsTrigger>}
          {manage && <TabsTrigger value="beta">{t("betaTab")}</TabsTrigger>}
          {support && <TabsTrigger value="feedback">{t("feedbackTab")}</TabsTrigger>}
          {support && <TabsTrigger value="incidents">{t("incidentsTab")}</TabsTrigger>}
        </TabsList>
        {manage && <TabsContent value="switches" className="mt-4"><SwitchesTab /></TabsContent>}
        {manage && <TabsContent value="beta" className="mt-4"><BetaTab /></TabsContent>}
        {support && <TabsContent value="feedback" className="mt-4"><FeedbackTab /></TabsContent>}
        {support && <TabsContent value="incidents" className="mt-4"><IncidentsTab /></TabsContent>}
      </Tabs>
    </>
  );
}
