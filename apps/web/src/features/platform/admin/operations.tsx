"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { announcementSchema } from "@ieltiva/shared";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-provider";
import { api } from "@/lib/api-client";
import { formatDate, formatDateTime, fullName } from "../format";
import { applyFieldErrors, useApiAction, useApiPage, useApiQuery, useDebounced } from "../hooks";
import { useLabels } from "../labels";
import { ConfirmButton, Empty, FormDialog, InputField, PageHeader, Pagination, QueryBoundary, SearchField, SelectBox, StatusBadge, TableFrame, TextAreaField, tdClass, thClass } from "../ui";

type EnrollmentRow = { id: string; status: string; createdAt: string; completedAt: string | null; course: { id: string; title: string }; user: { id: string; email: string; profile: { firstName: string; lastName: string } | null } };

export function EnrollmentsPage() {
  const t = useTranslations("app");
  const labels = useLabels();
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const query = useApiPage<EnrollmentRow>("/enrollments", { page, pageSize: 20, search: debounced, status });
  const update = useApiAction(({ id, next }: { id: string; next: string }) => api.patch(`/enrollments/${id}`, { status: next }), t("enrollment_updated"));
  return (
    <>
      <PageHeader title={t("enrollments")} description={t("who_is_taking_which_course")} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SearchField label={t("search_by_student_or_course")} value={search} onChange={(value) => { setSearch(value); setPage(1); }} />
        <SelectBox hideLabel label={t("filter_by_status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: "", label: t("all_statuses") }, ...["ACTIVE", "COMPLETED", "CANCELED"].map((value) => ({ value, label: labels.status(value) }))]} />
      </div>
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? <Empty title={t("no_enrollments_found")} /> : (
            <>
              <TableFrame label={t("enrollments")}>
                <thead><tr>{[t("student"), t("course"), t("status"), t("enrolled"), t("completed"), t("actions")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className={tdClass}><p className="font-medium">{fullName(row.user.profile) || "-"}</p><p className="text-muted-foreground break-all text-xs">{row.user.email}</p></td>
                      <td className={tdClass}>{row.course.title}</td>
                      <td className={tdClass}><StatusBadge status={row.status} /></td>
                      <td className={tdClass}>{formatDate(row.createdAt)}</td>
                      <td className={tdClass}>{formatDate(row.completedAt)}</td>
                      <td className={tdClass}>
                        {!hasPermission("enrollments.manage") ? "-" : row.status === "CANCELED" ? (
                          <Button variant="outline" size="sm" onClick={() => update.mutate({ id: row.id, next: "ACTIVE" })}>{t("restore")}</Button>
                        ) : (
                          <ConfirmButton label={t("cancel_enrollment")} title={t("cancel_this_enrollment")} description={t("the_student_loses_access_and_is_told_about_the_change_t")} destructive onConfirm={() => update.mutate({ id: row.id, next: "CANCELED" })} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
              <Pagination meta={meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </>
  );
}

type Announcement = { id: string; title: string; body: string; audience: string; audienceRole: string | null; status: string; publishedAt: string | null; expiresAt: string | null; createdAt: string; recipients: number };

const ROLES = ["STUDENT", "INSTRUCTOR", "MARKER", "EDITOR", "ADMIN", "SUPER_ADMIN"];

export function AnnouncementsPage() {
  const t = useTranslations("app");
  const labels = useLabels();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const query = useApiPage<Announcement>("/admin/notifications", { page, pageSize: 15 });
  const form = useForm({
    resolver: zodResolver(announcementSchema),
    defaultValues: { title: "", body: "", audience: "ALL" as "ALL" | "ROLE", audienceRole: undefined as "STUDENT" | undefined, publish: true, expiresAt: undefined as string | undefined },
  });
  const audience = useWatch({ control: form.control, name: "audience" });
  const create = useApiAction((body: object) => api.post("/admin/notifications", body), t("announcement_saved"));
  const publish = useApiAction((id: string) => api.post(`/admin/notifications/${id}/publish`), t("announcement_published"));
  const archive = useApiAction((id: string) => api.post(`/admin/notifications/${id}/archive`), t("announcement_archived"));
  const { errors } = form.formState;
  return (
    <>
      <PageHeader
        title={t("announcements")}
        description={t("in_app_messages_to_everyone_or_to_one_role_email_and_pu")}
        actions={
          <FormDialog open={open} onOpenChange={setOpen} title={t("new_announcement")} trigger={<Button><Plus aria-hidden /> {t("new_announcement")}</Button>}>
            <form
              noValidate
              className="space-y-4"
              onSubmit={form.handleSubmit((values) =>
                create.mutate(values, {
                  onSuccess: () => {
                    form.reset();
                    setOpen(false);
                  },
                  onError: (error) => applyFieldErrors(error, form.setError),
                }),
              )}
            >
              <InputField label={t("title")} error={errors.title?.message} {...form.register("title")} />
              <TextAreaField label={t("message")} rows={4} error={errors.body?.message} {...form.register("body")} />
              <SelectBox label={t("audience")} options={[{ value: "ALL", label: t("everyone") }, { value: "ROLE", label: t("one_role") }]} {...form.register("audience")} />
              {audience === "ROLE" && (
                <SelectBox label={t("role")} error={errors.audienceRole?.message} options={[{ value: "", label: t("choose_a_role") }, ...ROLES.map((value) => ({ value, label: labels.role(value) }))]} {...form.register("audienceRole", { setValueAs: (value) => value || undefined })} />
              )}
              <InputField label={t("expires")} type="datetime-local" hint={t("optional_it_stops_showing_after_this_time")} error={errors.expiresAt?.message} {...form.register("expiresAt", { setValueAs: (value) => (value ? new Date(value).toISOString() : undefined) })} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary size-4" {...form.register("publish")} /> {t("publish_now_otherwise_it_s_saved_as_a_draft")}</label>
              <Button type="submit" disabled={create.isPending}>{t("save_announcement")}</Button>
            </form>
          </FormDialog>
        }
      />
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? <Empty title={t("no_announcements_yet")} /> : (
            <>
              <ul className="space-y-3">
                {items.map((row) => (
                  <li key={row.id}>
                    <Card className="shadow-soft">
                      <CardContent className="flex flex-col gap-3 md:flex-row md:items-start">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><h2 className="font-display font-semibold break-words">{row.title}</h2><StatusBadge status={row.status} /></div>
                          <p className="mt-1 text-sm break-words">{row.body}</p>
                          <p className="text-muted-foreground mt-2 flex flex-wrap gap-x-3 text-xs">
                            <span>{row.audience === "ROLE" ? labels.role(row.audienceRole) : t("everyone")}</span>
                            <span>{t("sent_to_count", { count: row.recipients })}</span>
                            <span>{formatDateTime(row.createdAt)}</span>
                            {row.expiresAt && <span>{t("expires_date", { date: formatDateTime(row.expiresAt) })}</span>}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {row.status === "DRAFT" && <ConfirmButton label={t("publish")} title={t("publish_this_announcement")} description={t("it_s_sent_to_its_audience_immediately")} onConfirm={() => publish.mutate(row.id)} />}
                          {row.status !== "ARCHIVED" && <ConfirmButton label={t("archive")} title={t("archive_this_announcement")} description={t("it_stops_showing_to_everyone")} onConfirm={() => archive.mutate(row.id)} />}
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
              <Pagination meta={meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </>
  );
}

type AuditRow = { id: string; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown; createdAt: string; actor: { id: string; email: string } | null };

export function AuditLogsPage() {
  const t = useTranslations("app");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const debouncedAction = useDebounced(action);
  const debouncedEntity = useDebounced(entityType);
  const query = useApiPage<AuditRow>("/admin/audit-logs", { page, pageSize: 25, action: debouncedAction, entityType: debouncedEntity, from, to });
  return (
    <>
      <PageHeader title={t("audit_logs")} description={t("a_permanent_record_of_administrative_actions_it_can_t_b")} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <SearchField label={t("filter_by_action")} value={action} onChange={(value) => { setAction(value); setPage(1); }} />
        <SearchField label={t("filter_by_target_type")} value={entityType} onChange={(value) => { setEntityType(value); setPage(1); }} />
        <InputField label={t("from")} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <InputField label={t("to")} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
      </div>
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? <Empty title={t("no_entries_found")} /> : (
            <>
              <TableFrame label={t("audit_logs")}>
                <thead><tr>{[t("time"), t("actor"), t("action"), t("target"), t("changes")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className={`${tdClass} whitespace-nowrap`}>{formatDateTime(row.createdAt)}</td>
                      <td className={`${tdClass} break-all`}>{row.actor?.email ?? t("system_or_removed_user")}</td>
                      <td className={tdClass}><Badge variant="secondary">{row.action}</Badge></td>
                      <td className={tdClass}><p>{row.entityType}</p><p className="text-muted-foreground font-mono text-xs break-all">{row.entityId ?? "-"}</p></td>
                      <td className={tdClass}>
                        {row.before || row.after ? (
                          <details>
                            <summary className="cursor-pointer text-sm">{t("view")}</summary>
                            <pre className="mt-2 max-w-sm overflow-x-auto text-xs whitespace-pre-wrap">{JSON.stringify({ before: row.before, after: row.after }, null, 2)}</pre>
                          </details>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
              <Pagination meta={meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </>
  );
}

type Setting = { key: string; value: unknown; description: string | null; updatedAt: string; editable: boolean };

function SettingRow({ setting, canEdit }: { setting: Setting; canEdit: boolean }) {
  const t = useTranslations("app");
  const isText = typeof setting.value === "number" || typeof setting.value === "string";
  const [text, setText] = useState(isText ? String(setting.value) : JSON.stringify(setting.value));
  const [invalid, setInvalid] = useState(false);
  const save = useApiAction((value: unknown) => api.patch(`/admin/settings/${encodeURIComponent(setting.key)}`, { value }), t("setting_saved"));
  const editable = canEdit && setting.editable;

  function submit() {
    try {
      const value = typeof setting.value === "number" ? Number(text) : typeof setting.value === "string" ? text : JSON.parse(text);
      setInvalid(false);
      save.mutate(value);
    } catch {
      setInvalid(true);
    }
  }

  return (
    <li className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="font-medium break-words">{setting.description ?? setting.key}</p>
        <p className="text-muted-foreground font-mono text-xs break-all">{setting.key}</p>
      </div>
      {editable ? (
        <form className="flex flex-wrap items-start gap-2" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div>
            <Input aria-label={t("value_for_key", { key: setting.key })} className="w-full sm:w-64" value={text} aria-invalid={invalid} onChange={(event) => setText(event.target.value)} />
            {invalid && <p role="alert" className="text-destructive mt-1 text-sm">{t("this_value_isn_t_valid")}</p>}
          </div>
          <Button type="submit" variant="outline" disabled={save.isPending}>{t("save")}</Button>
        </form>
      ) : (
        <code className="bg-muted rounded px-2 py-1 text-sm break-all">{text}</code>
      )}
    </li>
  );
}

export function SettingsAdminPage() {
  const t = useTranslations("app");
  const { hasPermission } = useAuth();
  const query = useApiQuery<Setting[]>("/admin/settings");
  const canEdit = hasPermission("settings.manage");
  return (
    <>
      <PageHeader title={t("platform_settings")} description={canEdit ? t("changes_are_validated_and_recorded_in_the_audit_log") : t("only_a_super_administrator_can_change_these")} />
      <QueryBoundary query={query}>
        {(rows) => rows.length === 0 ? <Empty title={t("no_settings_found")} /> : (
          <ul className="bg-card divide-y rounded-xl border">{rows.map((setting) => <SettingRow key={setting.key} setting={setting} canEdit={canEdit} />)}</ul>
        )}
      </QueryBoundary>
    </>
  );
}
