"use client";

import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Circle, CircleDot, Clock, ExternalLink, GraduationCap, Lock } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api-client";
import { formatDate, formatMinutes } from "../format";
import { useApiAction, useApiPage, useApiQuery, useDebounced } from "../hooks";
import { useLabels } from "../labels";
import { ConfirmButton, Empty, PageHeader, Pagination, QueryBoundary, SearchField, SelectBox } from "../ui";

export type CourseListItem = {
  id: string;
  title: string;
  description: string | null;
  examType: string | null;
  difficulty: string | null;
  estimatedMinutes: number | null;
  isPremium: boolean;
  thumbnailUrl: string | null;
  status: string;
  enrollmentCount: number;
  module: { id: string; name: string; skill: string | null };
  instructor: { id: string; name: string } | null;
  enrollment: { id: string; status: string } | null;
};

type CourseDetail = CourseListItem & {
  learningObjectives: string[];
  publishedAt: string | null;
  canManage: boolean;
  locked: boolean;
  enrollment: { id: string; status: string; createdAt: string; lastResourceId: string | null } | null;
  progress: { total: number; completed: number; percent: number };
  sections: { id: string; title: string; description: string | null; resources: { id: string; title: string; type: string; durationMinutes: number | null; progress: string }[] }[];
};

function Thumbnail({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div aria-hidden className="bg-accent text-accent-foreground flex h-32 items-center justify-center rounded-t-xl">
        <BookOpen className="size-8" />
      </div>
    );
  }
  // External images set by content managers. Next's image optimiser would need each host allowed in advance.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" referrerPolicy="no-referrer" className="h-32 w-full rounded-t-xl object-cover" />;
}

export function CourseCatalog() {
  const t = useTranslations("app");
  const labels = useLabels();
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState("");
  const [examType, setExamType] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [sort, setSort] = useState("-publishedAt");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const moduleId = params.get("moduleId") ?? undefined;
  const query = useApiPage<CourseListItem>("/courses", { page, pageSize: 12, search: debounced, skill, examType, difficulty, sort, moduleId });
  const reset = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t("browse_courses")} description={t("find_courses_for_your_ielts_type_and_skills")} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchField label={t("search_courses")} value={search} onChange={reset(setSearch)} />
        <SelectBox hideLabel label={t("ielts_type")} value={examType} onChange={(e) => reset(setExamType)(e.target.value)} options={[{ value: "", label: t("all_ielts_types") }, { value: "ACADEMIC", label: labels.examType("ACADEMIC") }, { value: "GENERAL_TRAINING", label: labels.examType("GENERAL_TRAINING") }]} />
        <SelectBox hideLabel label={t("skill")} value={skill} onChange={(e) => reset(setSkill)(e.target.value)} options={[{ value: "", label: t("all_skills") }, ...["LISTENING", "READING", "WRITING", "SPEAKING"].map((value) => ({ value, label: labels.skill(value) }))]} />
        <SelectBox hideLabel label={t("difficulty")} value={difficulty} onChange={(e) => reset(setDifficulty)(e.target.value)} options={[{ value: "", label: t("all_levels") }, ...["BEGINNER", "INTERMEDIATE", "ADVANCED"].map((value) => ({ value, label: labels.difficulty(value) }))]} />
        <SelectBox hideLabel label={t("sort_by")} value={sort} onChange={(e) => reset(setSort)(e.target.value)} options={[{ value: "-publishedAt", label: t("newest") }, { value: "title", label: t("title_a_to_z") }]} />
      </div>
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? (
            <Empty title={t("no_courses_found")} description={t("try_changing_your_search_or_filters")} />
          ) : (
            <>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((course) => (
                  <li key={course.id}>
                    <Card className="shadow-soft h-full gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md">
                      <Thumbnail url={course.thumbnailUrl} />
                      <CardContent className="flex flex-1 flex-col gap-2 p-4">
                        <h2 className="font-display font-semibold break-words">
                          <Link href={`/courses/${course.id}`} className="underline-offset-4 hover:underline">{course.title}</Link>
                        </h2>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="secondary">{course.module.name}</Badge>
                          <Badge variant="outline">{course.examType ? labels.examType(course.examType) : t("both_ielts_types")}</Badge>
                          {course.difficulty && <Badge variant="outline">{labels.difficulty(course.difficulty)}</Badge>}
                          {course.isPremium && <Badge variant="outline"><Lock aria-hidden /> {t("premium")}</Badge>}
                        </div>
                        {course.description && <p className="text-muted-foreground line-clamp-2 text-sm">{course.description}</p>}
                        {course.enrollment && course.enrollment.status !== "CANCELED" && (
                          <p className="text-success mt-auto flex items-center gap-1 pt-1 text-sm font-medium"><CheckCircle2 className="size-4" aria-hidden /> {t("enrolled")}</p>
                        )}
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

const progressIcon = (status: string) => (status === "COMPLETED" ? CheckCircle2 : status === "IN_PROGRESS" ? CircleDot : Circle);

export function CourseDetailView() {
  const t = useTranslations("app");
  const labels = useLabels();
  const { courseId } = useParams<{ courseId: string }>();
  const query = useApiQuery<CourseDetail>(`/courses/${courseId}`);
  const enroll = useApiAction(() => api.post("/enrollments", { courseId }), t("you_re_enrolled"));

  return (
    <QueryBoundary query={query}>
      {(course) => {
        const enrolled = Boolean(course.enrollment && course.enrollment.status !== "CANCELED");
        const canOpen = enrolled || course.canManage;
        const firstResource = course.sections.flatMap((section) => section.resources).find((resource) => resource.progress !== "COMPLETED") ?? course.sections[0]?.resources[0];
        const continueId = course.enrollment?.lastResourceId ?? firstResource?.id;
        return (
          <>
            <PageHeader
              title={course.title}
              description={course.description ?? undefined}
              actions={
                enrolled ? (
                  continueId && (
                    <Button asChild>
                      <Link href={`/courses/${course.id}/resources/${continueId}`}>{t("continue_learning")} <ArrowRight aria-hidden /></Link>
                    </Button>
                  )
                ) : course.locked ? (
                  <Button disabled><Lock aria-hidden /> {t("premium_course")}</Button>
                ) : course.status === "PUBLISHED" ? (
                  <Button disabled={enroll.isPending} onClick={() => enroll.mutate()}>{t("enroll_now")}</Button>
                ) : null
              }
            />
            {course.locked && (
              <p className="bg-card mb-6 rounded-xl border p-4 text-sm">{t("this_course_needs_a_practice_pass_passes_aren_t_on_sale")}</p>
            )}
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                {course.learningObjectives.length > 0 && (
                  <Card className="shadow-soft">
                    <CardHeader><CardTitle className="font-display text-lg">{t("what_you_ll_learn")}</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm">
                        {course.learningObjectives.map((objective) => (
                          <li key={objective} className="flex gap-2"><CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-hidden /><span className="min-w-0 break-words">{objective}</span></li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
                <section aria-labelledby="content" className="space-y-3">
                  <h2 id="content" className="font-display text-lg font-semibold">{t("course_content")}</h2>
                  {course.sections.length === 0 && <Empty title={t("no_content_yet")} />}
                  {course.sections.map((section) => (
                    <Card key={section.id}>
                      <CardHeader>
                        <CardTitle className="font-display text-base break-words">{section.title}</CardTitle>
                        {section.description && <p className="text-muted-foreground text-sm">{section.description}</p>}
                      </CardHeader>
                      <CardContent>
                        <ul className="divide-y">
                          {section.resources.map((resource) => {
                            const Icon = progressIcon(resource.progress);
                            return (
                              <li key={resource.id} className="flex items-center gap-3 py-2 text-sm">
                                <Icon className={resource.progress === "COMPLETED" ? "text-success size-4 shrink-0" : "text-muted-foreground size-4 shrink-0"} aria-hidden />
                                <span className="sr-only">{labels.status(resource.progress === "COMPLETED" ? "COMPLETED" : "")}</span>
                                <div className="min-w-0 flex-1">
                                  {canOpen ? (
                                    <Link href={`/courses/${course.id}/resources/${resource.id}`} className="font-medium break-words underline-offset-4 hover:underline">{resource.title}</Link>
                                  ) : (
                                    <span className="font-medium break-words">{resource.title}</span>
                                  )}
                                  <p className="text-muted-foreground text-xs">{labels.resourceType(resource.type)}{resource.durationMinutes ? ` · ${formatMinutes(resource.durationMinutes)}` : ""}</p>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                </section>
              </div>
              <aside className="space-y-4">
                {enrolled && (
                  <Card className="shadow-soft">
                    <CardHeader><CardTitle className="font-display text-lg">{t("your_progress")}</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      <Progress value={course.progress.percent} aria-label={t("course_progress")} />
                      <p className="text-sm">{t("percent_complete_completed_of_total", { percent: course.progress.percent, completed: course.progress.completed, total: course.progress.total })}</p>
                      <p className="text-muted-foreground text-xs">{t("enrolled_on_date", { date: formatDate(course.enrollment?.createdAt) })}</p>
                    </CardContent>
                  </Card>
                )}
                <Card className="shadow-soft">
                  <CardHeader><CardTitle className="font-display text-lg">{t("about_this_course")}</CardTitle></CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                      <dt className="text-muted-foreground">{t("module")}</dt><dd className="break-words">{course.module.name}</dd>
                      <dt className="text-muted-foreground">{t("ielts_type")}</dt><dd>{course.examType ? labels.examType(course.examType) : t("both_ielts_types")}</dd>
                      <dt className="text-muted-foreground">{t("difficulty")}</dt><dd>{labels.difficulty(course.difficulty)}</dd>
                      <dt className="text-muted-foreground">{t("duration")}</dt><dd>{course.estimatedMinutes ? formatMinutes(course.estimatedMinutes) : "-"}</dd>
                      <dt className="text-muted-foreground">{t("instructor")}</dt><dd className="break-words">{course.instructor?.name || "-"}</dd>
                    </dl>
                  </CardContent>
                </Card>
              </aside>
            </div>
          </>
        );
      }}
    </QueryBoundary>
  );
}

type ResourceView = {
  id: string;
  title: string;
  type: string;
  durationMinutes: number | null;
  body: string | null;
  externalUrl: string | null;
  enrolled: boolean;
  section: { id: string; title: string };
  course: { id: string; title: string };
  previousId: string | null;
  nextId: string | null;
  progress: string;
};

export function ResourceViewPage() {
  const t = useTranslations("app");
  const labels = useLabels();
  const { courseId, resourceId } = useParams<{ courseId: string; resourceId: string }>();
  const router = useRouter();
  const query = useApiQuery<ResourceView>(`/resources/${resourceId}`);
  const opened = useRef<string | null>(null);
  const openedAt = useRef(0);
  const enrolled = query.data?.enrolled;

  useEffect(() => {
    if (!enrolled || opened.current === resourceId) return;
    opened.current = resourceId;
    openedAt.current = Date.now();
    void api.post("/progress", { resourceId, status: "IN_PROGRESS" }).catch(() => {});
  }, [enrolled, resourceId]);

  const complete = useApiAction(
    () => api.post<{ courseCompleted: boolean }>("/progress", { resourceId, status: "COMPLETED", minutesSpent: Math.min(240, Math.round((Date.now() - openedAt.current) / 60_000)) }),
  );

  return (
    <QueryBoundary query={query}>
      {(resource) => {
        const done = resource.progress === "COMPLETED";
        return (
          <article className="mx-auto max-w-3xl">
            <Button asChild variant="ghost" size="sm" className="mb-3">
              <Link href={`/courses/${courseId}`}><ArrowLeft aria-hidden /> {resource.course.title}</Link>
            </Button>
            <p className="text-muted-foreground text-sm">{resource.section.title} · {labels.resourceType(resource.type)}{resource.durationMinutes ? ` · ${formatMinutes(resource.durationMinutes)}` : ""}</p>
            <h1 className="font-display mt-1 text-2xl font-bold break-words sm:text-3xl">{resource.title}</h1>
            {/* Shown as plain text, so lesson content can never run as code in a student's browser. */}
            {resource.body && <div className="mt-6 leading-relaxed break-words whitespace-pre-wrap">{resource.body}</div>}
            {resource.externalUrl && (
              <Button asChild variant="outline" className="mt-6">
                <a href={resource.externalUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden /> {t("open_resource")}<span className="sr-only"> {t("opens_in_a_new_tab")}</span>
                </a>
              </Button>
            )}
            <div className="mt-8 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                <Button asChild={Boolean(resource.previousId)} variant="outline" disabled={!resource.previousId}>
                  {resource.previousId ? <Link href={`/courses/${courseId}/resources/${resource.previousId}`}><ArrowLeft aria-hidden /> {t("previous")}</Link> : <span><ArrowLeft aria-hidden /> {t("previous")}</span>}
                </Button>
                <Button asChild={Boolean(resource.nextId)} variant="outline" disabled={!resource.nextId}>
                  {resource.nextId ? <Link href={`/courses/${courseId}/resources/${resource.nextId}`}>{t("next")} <ArrowRight aria-hidden /></Link> : <span>{t("next")} <ArrowRight aria-hidden /></span>}
                </Button>
              </div>
              {resource.enrolled && (
                done ? (
                  <p className="text-success flex items-center gap-1.5 text-sm font-medium"><CheckCircle2 className="size-4" aria-hidden /> {t("completed")}</p>
                ) : (
                  <Button
                    disabled={complete.isPending}
                    onClick={() =>
                      complete.mutate(undefined, {
                        onSuccess: (result) => {
                          toast.success(result.courseCompleted ? t("course_completed_well_done") : t("marked_as_complete"));
                          if (resource.nextId) router.push(`/courses/${courseId}/resources/${resource.nextId}`);
                        },
                      })
                    }
                  >
                    <CheckCircle2 aria-hidden /> {t("mark_as_complete")}
                  </Button>
                )
              )}
            </div>
          </article>
        );
      }}
    </QueryBoundary>
  );
}

type MyEnrollment = {
  id: string;
  courseId: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  lastAccessedAt: string | null;
  lastResourceId: string | null;
  course: { title: string; difficulty: string | null; module: { name: string } };
  progress: { total: number; completed: number; percent: number };
};

export function MyLearning() {
  const t = useTranslations("app");
  const labels = useLabels();
  const [page, setPage] = useState(1);
  const query = useApiPage<MyEnrollment>("/enrollments/me", { page, pageSize: 10 });
  const cancel = useApiAction((id: string) => api.patch(`/enrollments/${id}`, { status: "CANCELED" }), t("you_ve_left_this_course"));
  return (
    <>
      <PageHeader
        title={t("my_learning")}
        description={t("your_courses_progress_and_where_you_left_off")}
        actions={<Button asChild variant="outline"><Link href="/courses"><BookOpen aria-hidden /> {t("browse_courses")}</Link></Button>}
      />
      <QueryBoundary query={query}>
        {({ items, meta }) =>
          items.length === 0 ? (
            <Empty icon={<GraduationCap aria-hidden />} title={t("you_haven_t_enrolled_yet")} description={t("choose_a_course_to_begin")} action={<Button asChild><Link href="/courses">{t("browse_courses")}</Link></Button>} />
          ) : (
            <>
              <ul className="space-y-3">
                {items.map((row) => (
                  <li key={row.id}>
                    <Card className="shadow-soft">
                      <CardContent className="flex flex-col gap-4 md:flex-row md:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-display font-semibold break-words"><Link href={`/courses/${row.courseId}`} className="underline-offset-4 hover:underline">{row.course.title}</Link></h2>
                            <Badge variant="secondary">{labels.status(row.status)}</Badge>
                          </div>
                          <p className="text-muted-foreground text-sm">{row.course.module.name}</p>
                          <Progress className="mt-3" value={row.progress.percent} aria-label={t("progress_in_course", { course: row.course.title })} />
                          <p className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 text-xs">
                            <span>{t("percent_complete_completed_of_total", { percent: row.progress.percent, completed: row.progress.completed, total: row.progress.total })}</span>
                            {row.lastAccessedAt && <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden /> {t("last_opened_date", { date: formatDate(row.lastAccessedAt) })}</span>}
                          </p>
                        </div>
                        {row.status !== "CANCELED" ? (
                          <div className="flex flex-wrap gap-2">
                            <Button asChild size="sm"><Link href={row.lastResourceId ? `/courses/${row.courseId}/resources/${row.lastResourceId}` : `/courses/${row.courseId}`}>{t("continue")}</Link></Button>
                            {row.status === "ACTIVE" && (
                              <ConfirmButton label={t("leave")} title={t("leave_this_course")} description={t("your_progress_is_kept_and_you_can_enroll_again_later")} destructive onConfirm={() => cancel.mutate(row.id)} />
                            )}
                          </div>
                        ) : (
                          <Button asChild size="sm" variant="outline"><Link href={`/courses/${row.courseId}`}>{t("view_course")}</Link></Button>
                        )}
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

type PracticeModule = { id: string; name: string; description: string | null; skill: string | null; courseCount: number };

export function PracticeOverview() {
  const t = useTranslations("app");
  const query = useApiPage<PracticeModule>("/modules", { pageSize: 50 });
  return (
    <>
      <PageHeader title={t("ielts_practice")} description={t("timed_practice_tests_are_coming_in_the_next_phase_for_n")} />
      <QueryBoundary query={query}>
        {({ items }) =>
          items.length === 0 ? (
            <Empty title={t("no_modules_available_yet")} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((module) => (
                <li key={module.id}>
                  <Card className="shadow-soft h-full">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="font-display text-lg break-words">{module.name}</CardTitle>
                        <Badge variant="outline">{t("practice_later")}</Badge>
                      </div>
                      {module.description && <p className="text-muted-foreground text-sm">{module.description}</p>}
                    </CardHeader>
                    <CardContent>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/courses?moduleId=${module.id}`}>{module.courseCount === 1 ? t("view_1_course") : t("view_count_courses", { count: module.courseCount })}</Link>
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </QueryBoundary>
    </>
  );
}
