"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/features/auth/auth-provider";
import { api } from "@/lib/api-client";
import { formatDate, formatDateTime, formatMinutes, fullName } from "../format";
import { useApiAction, useApiPage, useApiQuery, useDebounced } from "../hooks";
import { useLabels } from "../labels";
import { ConfirmButton, Empty, FormDialog, InputField, PageHeader, Pagination, QueryBoundary, SearchField, SelectBox, StatusBadge, TableFrame, tdClass, thClass } from "../ui";

type UserRow = { id: string; email: string; firstName: string; lastName: string; status: string; emailVerified: boolean; roles: string[]; createdAt: string; lastLoginAt: string | null };

const ROLES = ["STUDENT", "INSTRUCTOR", "MARKER", "EDITOR", "ADMIN", "SUPER_ADMIN"];

function SortHeader({ label, field, sort, onSort }: { label: string; field: string; sort: string; onSort: (value: string) => void }) {
  const active = sort.replace("-", "") === field;
  const descending = sort.startsWith("-");
  const Icon = !active ? ChevronsUpDown : descending ? ArrowDown : ArrowUp;
  return (
    <th scope="col" className={thClass} aria-sort={active ? (descending ? "descending" : "ascending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 uppercase" onClick={() => onSort(active && !descending ? `-${field}` : field)}>
        {label} <Icon className="size-3.5" aria-hidden />
      </button>
    </th>
  );
}

export function UserList() {
  const t = useTranslations("app");
  const labels = useLabels();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("-createdAt");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const query = useApiPage<UserRow>("/users", { page, pageSize: 20, search: debounced, role, status, sort });
  return (
    <>
      <PageHeader title={t("users")} description={t("search_and_manage_accounts")} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <SearchField label={t("search_by_name_or_email")} value={search} onChange={(value) => { setSearch(value); setPage(1); }} />
        <SelectBox hideLabel label={t("filter_by_role")} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} options={[{ value: "", label: t("all_roles") }, ...ROLES.map((value) => ({ value, label: labels.role(value) }))]} />
        <SelectBox hideLabel label={t("filter_by_status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: "", label: t("all_statuses") }, ...["ACTIVE", "SUSPENDED", "DELETION_PENDING"].map((value) => ({ value, label: labels.status(value) }))]} />
      </div>
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? (
            <Empty title={t("no_users_found")} description={t("try_changing_your_search_or_filters")} />
          ) : (
            <>
              <TableFrame label={t("users")}>
                <thead>
                  <tr>
                    <th scope="col" className={thClass}>{t("name")}</th>
                    <SortHeader label={t("email")} field="email" sort={sort} onSort={setSort} />
                    <th scope="col" className={thClass}>{t("role")}</th>
                    <th scope="col" className={thClass}>{t("status")}</th>
                    <th scope="col" className={thClass}>{t("verified")}</th>
                    <SortHeader label={t("registered")} field="createdAt" sort={sort} onSort={setSort} />
                    <SortHeader label={t("last_sign_in")} field="lastLoginAt" sort={sort} onSort={setSort} />
                    <th scope="col" className={thClass}>{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((user) => (
                    <tr key={user.id}>
                      <td className={tdClass}>{fullName(user) || "-"}</td>
                      <td className={`${tdClass} break-all`}>{user.email}</td>
                      <td className={tdClass}>
                        <div className="flex flex-wrap gap-1">{user.roles.map((code) => <Badge key={code} variant="secondary">{labels.role(code)}</Badge>)}</div>
                      </td>
                      <td className={tdClass}><StatusBadge status={user.status} /></td>
                      <td className={tdClass}>{user.emailVerified ? t("yes") : t("no")}</td>
                      <td className={tdClass}>{formatDate(user.createdAt)}</td>
                      <td className={tdClass}>{formatDate(user.lastLoginAt)}</td>
                      <td className={tdClass}>
                        <Button asChild variant="outline" size="sm"><Link href={`/admin/users/${user.id}`} aria-label={t("view_name", { name: user.email })}>{t("view")}</Link></Button>
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

type UserDetail = UserRow & {
  enrollments: { id: string; status: string; createdAt: string; course: { id: string; title: string } }[];
  learning: { completedResources: number; loggedMinutes: number; lastActivityAt: string | null };
};
type Activity = {
  learning: { items: { id: string; eventType: string; occurredAt: string; course: { title: string } | null; resource: { title: string } | null }[] };
  auditEntries: { id: string; action: string; createdAt: string; actor: { email: string } | null }[];
};

export function UserDetailPage() {
  const t = useTranslations("app");
  const labels = useLabels();
  const { id } = useParams<{ id: string }>();
  const { user: me, hasPermission } = useAuth();
  const query = useApiQuery<UserDetail>(`/users/${id}`);
  const activity = useApiQuery<Activity>(`/users/${id}/activity?pageSize=10`);
  const [editOpen, setEditOpen] = useState(false);
  const [names, setNames] = useState({ firstName: "", lastName: "" });
  const [roles, setRoles] = useState<string[] | null>(null);
  const save = useApiAction((body: typeof names) => api.patch(`/users/${id}`, body), t("user_updated"));
  const setStatus = useApiAction((status: string) => api.patch(`/users/${id}/status`, { status }), t("status_updated"));
  const saveRoles = useApiAction((body: string[]) => api.patch(`/users/${id}/roles`, { roles: body }), t("roles_updated"));
  const canManage = hasPermission("users.manage");
  const self = me?.id === id;

  return (
    <QueryBoundary query={query}>
      {(user) => {
        const selected = roles ?? user.roles;
        return (
          <>
            <PageHeader
              title={fullName(user) || user.email}
              description={user.email}
              actions={
                canManage && (
                  <>
                    <FormDialog
                      open={editOpen}
                      onOpenChange={(open) => { setEditOpen(open); if (open) setNames({ firstName: user.firstName, lastName: user.lastName }); }}
                      title={t("edit_profile")}
                      trigger={<Button variant="outline" size="sm">{t("edit_profile")}</Button>}
                    >
                      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(names, { onSuccess: () => setEditOpen(false) }); }}>
                        <InputField label={t("first_name")} value={names.firstName} required onChange={(e) => setNames({ ...names, firstName: e.target.value })} />
                        <InputField label={t("last_name")} value={names.lastName} required onChange={(e) => setNames({ ...names, lastName: e.target.value })} />
                        <Button type="submit" disabled={save.isPending}>{t("save_changes")}</Button>
                      </form>
                    </FormDialog>
                    {!self && user.status !== "DELETED" && (
                      user.status === "SUSPENDED" ? (
                        <ConfirmButton label={t("restore_account")} title={t("restore_this_account")} description={t("they_ll_be_able_to_sign_in_again")} onConfirm={() => setStatus.mutate("ACTIVE")} />
                      ) : (
                        <ConfirmButton label={t("suspend_account")} title={t("suspend_this_account")} description={t("they_ll_be_signed_out_everywhere_and_can_t_sign_in_unti")} destructive confirmLabel={t("suspend")} onConfirm={() => setStatus.mutate("SUSPENDED")} />
                      )
                    )}
                  </>
                )
              }
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="shadow-soft">
                <CardHeader><CardTitle className="font-display text-lg">{t("account")}</CardTitle></CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">{t("status")}</dt><dd><StatusBadge status={user.status} /></dd>
                    <dt className="text-muted-foreground">{t("email_verified")}</dt><dd>{user.emailVerified ? t("yes") : t("no")}</dd>
                    <dt className="text-muted-foreground">{t("registered")}</dt><dd>{formatDate(user.createdAt)}</dd>
                    <dt className="text-muted-foreground">{t("last_sign_in")}</dt><dd>{formatDateTime(user.lastLoginAt)}</dd>
                    <dt className="text-muted-foreground">{t("completed_resources")}</dt><dd>{user.learning.completedResources}</dd>
                    <dt className="text-muted-foreground">{t("time_logged")}</dt><dd>{formatMinutes(user.learning.loggedMinutes)}</dd>
                    <dt className="text-muted-foreground">{t("last_activity")}</dt><dd>{formatDateTime(user.learning.lastActivityAt)}</dd>
                  </dl>
                </CardContent>
              </Card>

              <Card className="shadow-soft">
                <CardHeader><CardTitle className="font-display text-lg">{t("roles")}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <fieldset className="space-y-2" disabled={!hasPermission("roles.assign")}>
                    <legend className="sr-only">{t("assigned_roles")}</legend>
                    {ROLES.map((code) => (
                      <div key={code} className="flex items-center gap-2">
                        <Checkbox
                          id={`role-${code}`}
                          disabled={!hasPermission("roles.assign")}
                          checked={selected.includes(code)}
                          onCheckedChange={(checked) => setRoles(checked ? [...selected, code] : selected.filter((value) => value !== code))}
                        />
                        <Label htmlFor={`role-${code}`}>{labels.role(code)}</Label>
                      </div>
                    ))}
                  </fieldset>
                  {hasPermission("roles.assign") && (
                    <ConfirmButton
                      label={t("save_roles")}
                      disabled={!roles || selected.length === 0 || saveRoles.isPending}
                      title={t("change_this_person_s_roles")}
                      description={t("their_access_changes_immediately_you_can_only_assign_ro")}
                      onConfirm={() => saveRoles.mutate(selected, { onSuccess: () => setRoles(null), onError: () => setRoles(null) })}
                    />
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-soft">
                <CardHeader><CardTitle className="font-display text-lg">{t("enrollments")}</CardTitle></CardHeader>
                <CardContent>
                  {user.enrollments.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{t("no_enrollments_yet")}</p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {user.enrollments.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 break-words">{row.course.title}</span>
                          <StatusBadge status={row.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-soft lg:col-span-3">
                <CardHeader><CardTitle className="font-display text-lg">{t("activity")}</CardTitle></CardHeader>
                <CardContent>
                  <QueryBoundary query={activity}>
                    {({ learning, auditEntries }) => (
                      <div className="grid gap-6 md:grid-cols-2">
                        <section>
                          <h2 className="mb-2 text-sm font-semibold">{t("learning")}</h2>
                          {learning.items.length === 0 ? <p className="text-muted-foreground text-sm">{t("no_activity_yet")}</p> : (
                            <ul className="space-y-2 text-sm">
                              {learning.items.map((row) => (
                                <li key={row.id}><p className="break-words">{labels.event(row.eventType)}: {row.resource?.title ?? row.course?.title ?? "-"}</p><time className="text-muted-foreground text-xs">{formatDateTime(row.occurredAt)}</time></li>
                              ))}
                            </ul>
                          )}
                        </section>
                        {hasPermission("audit.read") && (
                          <section>
                            <h2 className="mb-2 text-sm font-semibold">{t("administrative_changes")}</h2>
                            {auditEntries.length === 0 ? <p className="text-muted-foreground text-sm">{t("nothing_yet")}</p> : (
                              <ul className="space-y-2 text-sm">
                                {auditEntries.map((row) => (
                                  <li key={row.id}><p className="break-words">{row.action} {row.actor ? `(${row.actor.email})` : ""}</p><time className="text-muted-foreground text-xs">{formatDateTime(row.createdAt)}</time></li>
                                ))}
                              </ul>
                            )}
                          </section>
                        )}
                      </div>
                    )}
                  </QueryBoundary>
                </CardContent>
              </Card>
            </div>
          </>
        );
      }}
    </QueryBoundary>
  );
}

type Role = { id: string; code: string; name: string; description: string | null; userCount: number; permissions: string[]; locked: boolean };
type PermissionGroup = { key: string; label: string; permissions: { code: string; description: string | null; critical: boolean }[] };

function RoleEditor({ role, groups }: { role: Role; groups: PermissionGroup[] }) {
  const t = useTranslations("app");
  const labels = useLabels();
  const { hasPermission } = useAuth();
  const [selected, setSelected] = useState(role.permissions);
  const canEdit = hasPermission("roles.manage") && !role.locked;
  const save = useApiAction(() => api.patch(`/roles/${role.id}/permissions`, { permissions: selected }), t("role_permissions_updated"));
  const dirty = [...selected].sort().join() !== [...role.permissions].sort().join();
  return (
    <Card className="shadow-soft">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-display text-lg">{labels.role(role.code, role.name)}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{role.userCount === 1 ? t("1_user") : t("count_users", { count: role.userCount })}</Badge>
            {role.locked && <Badge variant="outline">{t("protected")}</Badge>}
          </div>
        </div>
        {role.description && <p className="text-muted-foreground text-sm">{role.description}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <fieldset key={group.key}>
              <legend className="mb-1.5 text-sm font-semibold">{group.label}</legend>
              <div className="space-y-1.5">
                {group.permissions.map((permission) => {
                  const id = `${role.code}-${permission.code}`;
                  return (
                    <div key={permission.code} className="flex items-start gap-2">
                      <Checkbox
                        id={id}
                        className="mt-0.5"
                        disabled={!canEdit || permission.critical}
                        checked={selected.includes(permission.code)}
                        onCheckedChange={(checked) => setSelected((current) => (checked ? [...current, permission.code] : current.filter((value) => value !== permission.code)))}
                      />
                      <Label htmlFor={id} className="text-sm leading-snug font-normal">
                        {permission.description ?? permission.code}
                        {permission.critical && <span className="text-muted-foreground"> ({t("protected_2d07")})</span>}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        {canEdit && (
          <ConfirmButton
            label={t("save_permissions")}
            disabled={!dirty || save.isPending}
            title={t("change_this_role_s_permissions")}
            description={t("this_affects_everyone_with_the_role_immediately")}
            onConfirm={() => save.mutate(undefined, { onError: () => setSelected(role.permissions) })}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function RolesPage() {
  const t = useTranslations("app");
  const roles = useApiQuery<Role[]>("/roles");
  const groups = useApiQuery<PermissionGroup[]>("/permissions");
  const { hasPermission } = useAuth();
  return (
    <>
      <PageHeader
        title={t("roles_and_permissions")}
        description={hasPermission("roles.manage") ? t("change_what_each_role_can_do_system_critical_permission") : t("see_what_each_role_can_do_only_a_super_administrator_ca")}
      />
      <QueryBoundary query={roles}>
        {(rows) => (
          <QueryBoundary query={groups}>
            {(permissionGroups) => (
              <div className="space-y-4">
                {rows.map((role) => <RoleEditor key={`${role.id}-${role.permissions.join()}`} role={role} groups={permissionGroups} />)}
              </div>
            )}
          </QueryBoundary>
        )}
      </QueryBoundary>
    </>
  );
}
