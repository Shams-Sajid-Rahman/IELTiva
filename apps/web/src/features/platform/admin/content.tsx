"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { courseBodySchema, moduleBodySchema, resourceBodySchema, sectionBodySchema } from "@ieltiva/shared";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/features/auth/auth-provider";
import { api, ApiRequestError } from "@/lib/api-client";
import { formatDate, formatDateTime } from "../format";
import { applyFieldErrors, useApiAction, useApiPage, useApiQuery, useDebounced } from "../hooks";
import { useLabels } from "../labels";
import { ConfirmButton, Empty, FormDialog, InputField, PageHeader, Pagination, QueryBoundary, SearchField, SelectBox, StatusBadge, TableFrame, TextAreaField, tdClass, thClass } from "../ui";

type ModuleRow = { id: string; name: string; description: string | null; skill: string | null; examType: string | null; difficulty: string | null; estimatedMinutes: number | null; status: string; position: number; courseCount: number };
type CourseRow = { id: string; title: string; slug: string; status: string; examType: string | null; difficulty: string | null; enrollmentCount: number; updatedAt: string; module: { id: string; name: string }; instructor: { id: string; name: string } | null };
type Resource = { id: string; position: number; type: string; title: string; durationMinutes: number | null; body?: string | null; externalUrl?: string | null };
type Section = { id: string; position: number; title: string; description: string | null; isVisible: boolean; resources: Resource[] };
type CourseEditorData = CourseRow & { description: string | null; thumbnailUrl: string | null; learningObjectives: string[]; estimatedMinutes: number | null; isPremium: boolean; canManage: boolean; sections: Section[] };
type HistoryEntry = { id: string; action: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string; actorName: string | null };

const blankToNull = (value: unknown) => (value === "" || value === undefined ? null : value);
const numberOrNull = (value: unknown) => (value === "" || value === undefined || value === null ? null : Number(value));

function useContentOptions() {
  const labels = useLabels();
  const t = labels.t;
  return {
    labels,
    examTypes: [{ value: "", label: t("both_ielts_types") }, { value: "ACADEMIC", label: labels.examType("ACADEMIC") }, { value: "GENERAL_TRAINING", label: labels.examType("GENERAL_TRAINING") }],
    difficulties: [{ value: "", label: t("not_set") }, ...["BEGINNER", "INTERMEDIATE", "ADVANCED"].map((value) => ({ value, label: labels.difficulty(value) }))],
    skills: [{ value: "", label: t("general_ielts_preparation") }, ...["LISTENING", "READING", "WRITING", "SPEAKING"].map((value) => ({ value, label: labels.skill(value) }))],
    resourceTypes: ["ARTICLE", "VOCABULARY", "GRAMMAR", "PRACTICE_GUIDANCE", "DOCUMENT", "VIDEO", "EXTERNAL_LINK"].map((value) => ({ value, label: labels.resourceType(value) })),
  };
}

// Modules

function ModuleForm({ initial, onDone }: { initial?: ModuleRow; onDone: () => void }) {
  const t = useTranslations("app");
  const { examTypes, difficulties, skills } = useContentOptions();
  const form = useForm({
    resolver: zodResolver(moduleBodySchema),
    defaultValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      skill: (initial?.skill ?? null) as "LISTENING" | null,
      examType: (initial?.examType ?? null) as "ACADEMIC" | null,
      difficulty: (initial?.difficulty ?? null) as "BEGINNER" | null,
      estimatedMinutes: initial?.estimatedMinutes ?? null,
      position: initial?.position ?? 0,
    },
  });
  const save = useApiAction((body: object) => (initial ? api.patch(`/modules/${initial.id}`, body) : api.post("/modules", body)), t("module_saved"));
  const { errors } = form.formState;
  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit((values) => save.mutate(values, { onSuccess: onDone, onError: (error) => applyFieldErrors(error, form.setError) }))}>
      <InputField label={t("module_title")} error={errors.name?.message} {...form.register("name")} />
      <TextAreaField label={t("description")} rows={3} error={errors.description?.message} {...form.register("description")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectBox label={t("ielts_skill")} options={skills} {...form.register("skill", { setValueAs: blankToNull })} />
        <SelectBox label={t("ielts_type")} options={examTypes} {...form.register("examType", { setValueAs: blankToNull })} />
        <SelectBox label={t("difficulty")} options={difficulties} {...form.register("difficulty", { setValueAs: blankToNull })} />
        <InputField label={t("estimated_minutes")} type="number" min={1} error={errors.estimatedMinutes?.message} {...form.register("estimatedMinutes", { setValueAs: numberOrNull })} />
        <InputField label={t("display_order")} type="number" min={0} error={errors.position?.message} {...form.register("position", { setValueAs: (value) => Number(value || 0) })} />
      </div>
      <Button type="submit" disabled={save.isPending}>{t("save_module")}</Button>
    </form>
  );
}

export function ModulesPage() {
  const t = useTranslations("app");
  const { labels } = useContentOptions();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const debounced = useDebounced(search);
  const query = useApiPage<ModuleRow>("/modules", { page, pageSize: 20, status, search: debounced });
  const publish = useApiAction((id: string) => api.post(`/modules/${id}/publish`), t("module_published"));
  const archive = useApiAction((id: string) => api.post(`/modules/${id}/archive`), t("module_archived"));
  return (
    <>
      <PageHeader
        title={t("learning_modules")}
        description={t("modules_group_courses_by_skill_and_appear_in_ielts_prac")}
        actions={
          <FormDialog open={creating} onOpenChange={setCreating} title={t("new_module")} trigger={<Button><Plus aria-hidden /> {t("new_module")}</Button>}>
            <ModuleForm onDone={() => setCreating(false)} />
          </FormDialog>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SearchField label={t("search_modules")} value={search} onChange={(value) => { setSearch(value); setPage(1); }} />
        <SelectBox hideLabel label={t("filter_by_status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: "", label: t("all_statuses") }, ...["DRAFT", "PUBLISHED", "ARCHIVED"].map((value) => ({ value, label: labels.status(value) }))]} />
      </div>
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? <Empty title={t("no_modules_found")} /> : (
            <>
              <TableFrame label={t("learning_modules")}>
                <thead>
                  <tr>
                    {[t("order"), t("title"), t("skill"), t("ielts_type"), t("status"), t("courses"), t("actions")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className={tdClass}>{row.position}</td>
                      <td className={`${tdClass} font-medium`}>{row.name}</td>
                      <td className={tdClass}>{labels.skill(row.skill, t("general"))}</td>
                      <td className={tdClass}>{row.examType ? labels.examType(row.examType) : t("both")}</td>
                      <td className={tdClass}><StatusBadge status={row.status} /></td>
                      <td className={tdClass}>{row.courseCount}</td>
                      <td className={tdClass}>
                        <div className="flex flex-wrap gap-2">
                          <FormDialog open={editing === row.id} onOpenChange={(open) => setEditing(open ? row.id : null)} title={t("edit_module")} trigger={<Button variant="outline" size="sm">{t("edit")}</Button>}>
                            <ModuleForm initial={row} onDone={() => setEditing(null)} />
                          </FormDialog>
                          {row.status !== "PUBLISHED" && <Button size="sm" onClick={() => publish.mutate(row.id)}>{t("publish")}</Button>}
                          {row.status !== "ARCHIVED" && <ConfirmButton label={t("archive")} title={t("archive_this_module")} description={t("it_disappears_from_ielts_practice_modules_used_by_publi")} onConfirm={() => archive.mutate(row.id)} />}
                        </div>
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

// Courses

function CourseForm({ initial, onSaved }: { initial?: CourseEditorData; onSaved: (id: string) => void }) {
  const t = useTranslations("app");
  const { examTypes, difficulties } = useContentOptions();
  const modules = useApiPage<ModuleRow>("/modules", { pageSize: 100 });
  const form = useForm({
    resolver: zodResolver(courseBodySchema),
    defaultValues: {
      title: initial?.title ?? "",
      slug: initial?.slug ?? undefined,
      description: initial?.description ?? "",
      moduleId: initial?.module.id ?? "",
      examType: (initial?.examType ?? null) as "ACADEMIC" | null,
      difficulty: (initial?.difficulty ?? null) as "BEGINNER" | null,
      thumbnailUrl: initial?.thumbnailUrl ?? null,
      learningObjectives: initial?.learningObjectives ?? [],
      estimatedMinutes: initial?.estimatedMinutes ?? null,
      isPremium: initial?.isPremium ?? false,
    },
  });
  const [objectives, setObjectives] = useState((initial?.learningObjectives ?? []).join("\n"));
  const save = useApiAction((body: object) => (initial ? api.patch<{ id: string }>(`/courses/${initial.id}`, body) : api.post<{ id: string }>("/courses", body)), t("course_saved"));
  const { errors } = form.formState;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit((values) =>
        save.mutate(
          { ...values, learningObjectives: objectives.split("\n").map((line) => line.trim()).filter(Boolean) },
          { onSuccess: (row) => onSaved(row.id), onError: (error) => applyFieldErrors(error, form.setError) },
        ),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField label={t("course_title")} error={errors.title?.message} {...form.register("title")} />
        <InputField label={t("slug")} hint={t("leave_empty_to_create_one_from_the_title")} error={errors.slug?.message} {...form.register("slug", { setValueAs: (value) => value || undefined })} />
      </div>
      <TextAreaField label={t("description")} rows={3} error={errors.description?.message} {...form.register("description")} />
      <TextAreaField label={t("learning_objectives_one_per_line")} rows={3} value={objectives} onChange={(event) => setObjectives(event.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectBox label={t("learning_module")} error={errors.moduleId?.message} options={[{ value: "", label: t("choose_a_module") }, ...(modules.data?.items ?? []).map((row) => ({ value: row.id, label: row.name }))]} {...form.register("moduleId")} />
        <SelectBox label={t("ielts_type")} options={examTypes} {...form.register("examType", { setValueAs: blankToNull })} />
        <SelectBox label={t("difficulty")} options={difficulties} {...form.register("difficulty", { setValueAs: blankToNull })} />
        <InputField label={t("estimated_minutes")} type="number" min={1} error={errors.estimatedMinutes?.message} {...form.register("estimatedMinutes", { setValueAs: numberOrNull })} />
      </div>
      <InputField label={t("thumbnail_image_url")} type="url" hint={t("an_https_address_file_uploads_come_with_private_storage")} error={errors.thumbnailUrl?.message} {...form.register("thumbnailUrl", { setValueAs: blankToNull })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary size-4" {...form.register("isPremium")} /> {t("premium_course_needs_a_practice_pass_once_passes_are_av")}</label>
      <Button type="submit" disabled={save.isPending}>{t("save_course")}</Button>
    </form>
  );
}

export function CoursesAdminPage() {
  const t = useTranslations("app");
  const { labels } = useContentOptions();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const query = useApiPage<CourseRow>("/courses", { scope: "manage", page, pageSize: 20, search: debounced, status, sort: "-createdAt" });
  return (
    <>
      <PageHeader
        title={t("courses")}
        description={t("create_edit_and_publish_learning_content")}
        actions={
          <FormDialog open={creating} onOpenChange={setCreating} title={t("new_course")} trigger={<Button><Plus aria-hidden /> {t("new_course")}</Button>}>
            <CourseForm onSaved={(id) => { setCreating(false); router.push(`/admin/courses/${id}`); }} />
          </FormDialog>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SearchField label={t("search_courses")} value={search} onChange={(value) => { setSearch(value); setPage(1); }} />
        <SelectBox hideLabel label={t("filter_by_status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: "", label: t("all_statuses") }, ...["DRAFT", "PUBLISHED", "ARCHIVED"].map((value) => ({ value, label: labels.status(value) }))]} />
      </div>
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? (
            <Empty title={t("no_courses_found")} description={t("create_your_first_course_to_get_started")} />
          ) : (
            <>
              <TableFrame label={t("courses")}>
                <thead>
                  <tr>
                    {[t("title"), t("module"), t("instructor"), t("status"), t("students"), t("updated"), t("actions")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className={`${tdClass} font-medium`}>{row.title}</td>
                      <td className={tdClass}>{row.module.name}</td>
                      <td className={tdClass}>{row.instructor?.name || "-"}</td>
                      <td className={tdClass}><StatusBadge status={row.status} /></td>
                      <td className={tdClass}>{row.enrollmentCount}</td>
                      <td className={tdClass}>{formatDate(row.updatedAt)}</td>
                      <td className={tdClass}><Button asChild variant="outline" size="sm"><Link href={`/admin/courses/${row.id}`} aria-label={t("manage_title", { title: row.title })}>{t("manage")}</Link></Button></td>
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

function SectionForm({ courseId, section, onDone }: { courseId: string; section?: Section; onDone: () => void }) {
  const t = useTranslations("app");
  const form = useForm({ resolver: zodResolver(sectionBodySchema), defaultValues: { title: section?.title ?? "", description: section?.description ?? "" } });
  const save = useApiAction((body: object) => (section ? api.patch(`/sections/${section.id}`, body) : api.post(`/courses/${courseId}/sections`, body)), t("section_saved"));
  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit((values) => save.mutate(values, { onSuccess: onDone, onError: (error) => applyFieldErrors(error, form.setError) }))}>
      <InputField label={t("section_title")} error={form.formState.errors.title?.message} {...form.register("title")} />
      <TextAreaField label={t("description")} rows={2} {...form.register("description")} />
      <Button type="submit" disabled={save.isPending}>{t("save_section")}</Button>
    </form>
  );
}

function ResourceForm({ sectionId, resource, onDone }: { sectionId: string; resource?: Resource; onDone: () => void }) {
  const t = useTranslations("app");
  const { resourceTypes } = useContentOptions();
  const form = useForm({
    resolver: zodResolver(resourceBodySchema),
    defaultValues: {
      type: (resource?.type ?? "ARTICLE") as "ARTICLE",
      title: resource?.title ?? "",
      body: resource?.body ?? null,
      externalUrl: resource?.externalUrl ?? null,
      durationMinutes: resource?.durationMinutes ?? null,
    },
  });
  const [failure, setFailure] = useState<string | null>(null);
  const save = useApiAction((body: object) => (resource ? api.patch(`/resources/${resource.id}`, body) : api.post(`/sections/${sectionId}/resources`, body)), t("resource_saved"));
  const { errors } = form.formState;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit((values) =>
        save.mutate(values, {
          onSuccess: onDone,
          onError: (error) => {
            applyFieldErrors(error, form.setError);
            setFailure(error instanceof ApiRequestError ? error.message : null);
          },
        }),
      )}
    >
      {failure && <p role="alert" className="text-destructive text-sm">{failure}</p>}
      <SelectBox label={t("resource_type")} options={resourceTypes} {...form.register("type")} />
      <InputField label={t("resource_title")} error={errors.title?.message} {...form.register("title")} />
      <TextAreaField label={t("lesson_content")} rows={6} error={errors.body?.message} {...form.register("body", { setValueAs: blankToNull })} />
      <InputField label={t("link")} type="url" hint={t("an_https_address_needed_for_pdf_video_and_external_reso")} error={errors.externalUrl?.message} {...form.register("externalUrl", { setValueAs: blankToNull })} />
      <InputField label={t("minutes")} type="number" min={1} error={errors.durationMinutes?.message} {...form.register("durationMinutes", { setValueAs: numberOrNull })} />
      <Button type="submit" disabled={save.isPending}>{t("save_resource")}</Button>
    </form>
  );
}

function ResourceRow({ resource, sectionId, last }: { resource: Resource; sectionId: string; last: boolean }) {
  const t = useTranslations("app");
  const { labels } = useContentOptions();
  const [editing, setEditing] = useState(false);
  const move = useApiAction((position: number) => api.patch(`/resources/${resource.id}`, { position }));
  const remove = useApiAction(() => api.delete(`/resources/${resource.id}`), t("resource_removed"));
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <div className="min-w-0 flex-1 basis-40">
        <p className="font-medium break-words">{resource.title}</p>
        <p className="text-muted-foreground text-xs">{labels.resourceType(resource.type)}</p>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={t("move_title_up", { title: resource.title })} disabled={resource.position <= 1} onClick={() => move.mutate(resource.position - 1)}><ArrowUp aria-hidden /></Button>
        <Button variant="ghost" size="icon" aria-label={t("move_title_down", { title: resource.title })} disabled={last} onClick={() => move.mutate(resource.position + 1)}><ArrowDown aria-hidden /></Button>
        <FormDialog open={editing} onOpenChange={setEditing} title={t("edit_resource")} trigger={<Button variant="ghost" size="icon" aria-label={t("edit_title", { title: resource.title })}><Pencil aria-hidden /></Button>}>
          <ResourceForm sectionId={sectionId} resource={resource} onDone={() => setEditing(false)} />
        </FormDialog>
        <ConfirmButton variant="ghost" size="icon" label={<><Trash2 aria-hidden /><span className="sr-only">{t("remove_title", { title: resource.title })}</span></>} title={t("remove_this_resource")} description={t("students_completed_records_are_kept_but_it_disappears_f")} destructive onConfirm={() => remove.mutate()} />
      </div>
    </li>
  );
}

function SectionCard({ section, courseId, index, count }: { section: Section; courseId: string; index: number; count: number }) {
  const t = useTranslations("app");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const update = useApiAction((body: object) => api.patch(`/sections/${section.id}`, body));
  const archive = useApiAction(() => api.delete(`/sections/${section.id}`), t("section_archived"));
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-display text-base break-words">
            {section.title} {!section.isVisible && <Badge variant="outline">{t("hidden")}</Badge>}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="icon" aria-label={t("move_title_up", { title: section.title })} disabled={index === 0} onClick={() => update.mutate({ position: index })}><ArrowUp aria-hidden /></Button>
            <Button variant="ghost" size="icon" aria-label={t("move_title_down", { title: section.title })} disabled={index === count - 1} onClick={() => update.mutate({ position: index + 2 })}><ArrowDown aria-hidden /></Button>
            <Button variant="ghost" size="icon" aria-label={section.isVisible ? t("hide_title_from_students", { title: section.title }) : t("show_title_to_students", { title: section.title })} onClick={() => update.mutate({ isVisible: !section.isVisible })}>
              {section.isVisible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
            <FormDialog open={editing} onOpenChange={setEditing} title={t("edit_section")} trigger={<Button variant="ghost" size="icon" aria-label={t("edit_title", { title: section.title })}><Pencil aria-hidden /></Button>}>
              <SectionForm courseId={courseId} section={section} onDone={() => setEditing(false)} />
            </FormDialog>
            <ConfirmButton variant="ghost" size="icon" label={<><Trash2 aria-hidden /><span className="sr-only">{t("archive_title", { title: section.title })}</span></>} title={t("archive_this_section")} description={t("it_disappears_from_the_course_students_records_are_kept")} destructive onConfirm={() => archive.mutate()} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {section.resources.length === 0 ? <p className="text-muted-foreground text-sm">{t("no_resources_yet")}</p> : (
          <ul className="divide-y">
            {section.resources.map((resource, position) => <ResourceRow key={resource.id} resource={resource} sectionId={section.id} last={position === section.resources.length - 1} />)}
          </ul>
        )}
        <FormDialog open={adding} onOpenChange={setAdding} title={t("add_a_resource")} trigger={<Button variant="outline" size="sm" className="mt-3"><Plus aria-hidden /> {t("add_resource")}</Button>}>
          <ResourceForm sectionId={section.id} onDone={() => setAdding(false)} />
        </FormDialog>
      </CardContent>
    </Card>
  );
}

export function CourseEditor() {
  const t = useTranslations("app");
  const { labels } = useContentOptions();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const query = useApiQuery<CourseEditorData>(`/courses/${id}`);
  const history = useApiQuery<HistoryEntry[]>(`/courses/${id}/history`);
  const [addingSection, setAddingSection] = useState(false);
  const publish = useApiAction(() => api.post(`/courses/${id}/publish`), t("course_published"));
  const unpublish = useApiAction(() => api.post(`/courses/${id}/unpublish`), t("course_returned_to_draft"));
  const archive = useApiAction(() => api.post(`/courses/${id}/archive`), t("course_archived"));
  const remove = useApiAction(() => api.delete(`/courses/${id}`), t("course_deleted"));
  const canPublish = hasPermission("courses.publish");
  const problems = publish.error instanceof ApiRequestError ? publish.error.fieldErrors : [];

  return (
    <QueryBoundary query={query}>
      {(course) => (
        <>
          <PageHeader
            title={course.title}
            description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={course.status} /> <span>{course.module.name}</span></span>}
            actions={
              <>
                {canPublish && course.status !== "PUBLISHED" && <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()}>{t("publish")}</Button>}
                {canPublish && course.status === "PUBLISHED" && (
                  <ConfirmButton label={t("unpublish")} title={t("return_this_course_to_draft")} description={t("this_isn_t_allowed_while_students_are_taking_it")} onConfirm={() => unpublish.mutate()} />
                )}
                {canPublish && course.status !== "ARCHIVED" && (
                  <ConfirmButton label={t("archive")} title={t("archive_this_course")} description={t("new_students_can_t_enroll_enrolled_students_keep_access")} onConfirm={() => archive.mutate()} />
                )}
                {course.status !== "PUBLISHED" && (
                  <ConfirmButton label={t("delete")} title={t("delete_this_course")} description={t("courses_students_have_enrolled_in_can_only_be_archived")} destructive confirmLabel={t("delete")} onConfirm={() => remove.mutate(undefined, { onSuccess: () => router.push("/admin/courses") })} />
                )}
              </>
            }
          />
          {problems.length > 0 && (
            <div role="alert" className="border-destructive mb-4 rounded-xl border p-4 text-sm">
              <p className="font-medium">{t("this_course_isn_t_ready_to_publish")}</p>
              <ul className="mt-1 list-inside list-disc">{problems.map((problem) => <li key={problem.path}>{problem.message}</li>)}</ul>
            </div>
          )}
          {course.status === "PUBLISHED" && <p className="bg-card mb-4 rounded-xl border p-3 text-sm">{t("this_course_is_published_your_changes_are_visible_to_st")}</p>}
          <Tabs defaultValue="content">
            <TabsList>
              <TabsTrigger value="content">{t("content")}</TabsTrigger>
              <TabsTrigger value="details">{t("details")}</TabsTrigger>
              <TabsTrigger value="history">{t("history")}</TabsTrigger>
            </TabsList>
            <TabsContent value="content" className="mt-4 space-y-3">
              {course.sections.length === 0 && <Empty title={t("no_sections_yet")} description={t("add_a_section_then_add_resources_to_it")} />}
              {course.sections.map((section, index) => <SectionCard key={section.id} section={section} courseId={course.id} index={index} count={course.sections.length} />)}
              <FormDialog open={addingSection} onOpenChange={setAddingSection} title={t("add_a_section")} trigger={<Button variant="outline"><Plus aria-hidden /> {t("add_section")}</Button>}>
                <SectionForm courseId={course.id} onDone={() => setAddingSection(false)} />
              </FormDialog>
            </TabsContent>
            <TabsContent value="details" className="mt-4">
              <Card className="shadow-soft"><CardContent><CourseForm key={course.updatedAt} initial={course} onSaved={() => {}} /></CardContent></Card>
            </TabsContent>
            <TabsContent value="history" className="mt-4">
              <QueryBoundary query={history}>
                {(rows) => rows.length === 0 ? <Empty title={t("no_publication_history_yet")} /> : (
                  <ol className="bg-card divide-y rounded-xl border">
                    {rows.map((row) => (
                      <li key={row.id} className="flex flex-col gap-1 p-3 text-sm sm:flex-row sm:justify-between sm:gap-4">
                        <div className="min-w-0">
                          <p className="font-medium">{labels.action(row.action)}{row.actorName ? ` · ${row.actorName}` : ""}</p>
                          {row.note && <p className="text-muted-foreground break-words">{row.note}</p>}
                        </div>
                        <time className="text-muted-foreground shrink-0">{formatDateTime(row.createdAt)}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </QueryBoundary>
            </TabsContent>
          </Tabs>
        </>
      )}
    </QueryBoundary>
  );
}
