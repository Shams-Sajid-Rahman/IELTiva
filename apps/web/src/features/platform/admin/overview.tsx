"use client";

import { BookOpen, CreditCard, FileCheck, GraduationCap, Layers, UserCheck, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Stagger, StaggerItem } from "@/components/motion/reveal";
import { StatCard } from "@/components/feedback/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/features/auth/auth-provider";
import { formatDateTime, fullName } from "../format";
import { useApiQuery } from "../hooks";
import { useLabels } from "../labels";
import { InputField, LoadingBlocks, PageHeader, QueryBoundary } from "../ui";
import { PopularityChart, TrendChart } from "./charts";

type Named = { profile: { firstName: string; lastName: string } | null } | null;
type AdminDashboard = {
  metrics: { totalUsers: number; activeUsers: number; newUsers: number; students: number; instructors: number; courses: number; publishedCourses: number; modules: number; publishedModules: number; enrollments: number };
  activity: {
    recentUsers: ({ id: string; email: string; createdAt: string } & NonNullable<Named>)[];
    recentPublications: { id: string; createdAt: string; course: { title: string } | null; learningModule: { name: string } | null; actor: Named }[];
    recentEnrollments: { id: string; status: string; createdAt: string; course: { title: string }; user: Named }[];
    recentActions: { id: string; action: string; entityType: string; createdAt: string; actor: Named }[];
  };
};
type Analytics = { from: string; to: string; registrations: { day: string; count: number }[]; enrollments: { day: string; count: number }[]; activity: { day: string; count: number }[]; coursePopularity: { title: string; count: number }[] };

function ActivityCard({ title, rows, empty }: { title: string; rows: { id: string; text: string; time: string }[]; empty: string }) {
  return (
    <Card className="shadow-soft">
      <CardHeader><CardTitle className="font-display text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{empty}</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {rows.map((row) => (
              <li key={row.id} className="border-l-2 pl-3">
                <p className="break-words">{row.text}</p>
                <time className="text-muted-foreground text-xs">{formatDateTime(row.time)}</time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ContentMeter({ label, published, total }: { label: string; published: number; total: number }) {
  const t = useTranslations("app");
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{t("published_of_total", { published, total })}</span>
      </div>
      <Progress className="mt-2" value={total ? Math.round((published / total) * 100) : 0} aria-label={t("published_share", { label })} />
    </div>
  );
}

/** A panel for an area with no data until a later phase. It says so plainly and shows no placeholder figures. */
function NotYetCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  const t = useTranslations("app");
  return (
    <Card className="shadow-soft border-dashed">
      <CardContent className="flex gap-3">
        <div className="bg-muted text-muted-foreground h-fit shrink-0 rounded-lg p-2 [&_svg]:size-5">{icon}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display font-semibold">{title}</h3>
            <Badge variant="outline">{t("later")}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{body}</p>
        </div>
      </CardContent>
    </Card>
  );
}

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const PRESETS = [7, 30, 90] as const;

export function AdminOverview() {
  const t = useTranslations("app");
  const labels = useLabels();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const allowed = hasPermission("dashboard.admin");
  const canMark = hasPermission("calibration.mark");
  const canCourses = hasPermission("courses.manage") || hasPermission("courses.manage_all");
  const [from, setFrom] = useState(() => isoDaysAgo(29));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const dashboard = useApiQuery<AdminDashboard>("/dashboard/admin", { enabled: allowed });
  const analytics = useApiQuery<Analytics>(`/dashboard/analytics?from=${from}&to=${to}`, { enabled: allowed && Boolean(from && to) });

  // Instructors and editors work in the course area.
  useEffect(() => {
    if (!allowed) router.replace(canMark && !canCourses ? "/admin/calibration" : "/admin/courses");
  }, [allowed, canCourses, canMark, router]);
  if (!allowed) return <LoadingBlocks />;

  const preset = (days: number) => {
    setFrom(isoDaysAgo(days - 1));
    setTo(isoDaysAgo(0));
  };
  const activePreset = to === isoDaysAgo(0) ? PRESETS.find((days) => from === isoDaysAgo(days - 1)) : undefined;

  return (
    <>
      <PageHeader title={t("administration")} description={t("live_figures_from_the_platform_database")} />
      <QueryBoundary query={dashboard}>
        {({ metrics, activity }) => (
          <div className="space-y-8">
            <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StaggerItem className="h-full"><StatCard label={t("registered_users")} value={<AnimatedNumber value={metrics.totalUsers} />} hint={t("students_students_instructors_instructors", { students: metrics.students, instructors: metrics.instructors })} icon={<Users aria-hidden />} /></StaggerItem>
              <StaggerItem className="h-full"><StatCard label={t("active_users")} value={<AnimatedNumber value={metrics.activeUsers} />} hint={t("signed_in_during_the_last_30_days")} icon={<UserCheck aria-hidden />} /></StaggerItem>
              <StaggerItem className="h-full"><StatCard label={t("new_users")} value={<AnimatedNumber value={metrics.newUsers} />} hint={t("joined_in_the_last_30_days")} icon={<UserPlus aria-hidden />} /></StaggerItem>
              <StaggerItem className="h-full"><StatCard label={t("courses")} value={<AnimatedNumber value={metrics.courses} />} hint={t("count_published", { count: metrics.publishedCourses })} icon={<BookOpen aria-hidden />} /></StaggerItem>
              <StaggerItem className="h-full"><StatCard label={t("learning_modules")} value={<AnimatedNumber value={metrics.modules} />} hint={t("count_published", { count: metrics.publishedModules })} icon={<Layers aria-hidden />} /></StaggerItem>
              <StaggerItem className="h-full"><StatCard label={t("enrollments")} value={<AnimatedNumber value={metrics.enrollments} />} hint={t("excludes_canceled_enrollments")} icon={<GraduationCap aria-hidden />} /></StaggerItem>
            </Stagger>

            <section aria-labelledby="analytics-heading">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <h2 id="analytics-heading" className="font-display text-xl font-semibold">{t("trends")}</h2>
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
                  <div role="group" aria-label={t("date_range")} className="bg-muted inline-flex w-full rounded-lg p-1 sm:w-auto">
                    {PRESETS.map((days) => (
                      <Button key={days} variant={activePreset === days ? "default" : "ghost"} size="sm" className="flex-1 sm:flex-none" aria-pressed={activePreset === days} onClick={() => preset(days)}>
                        {t(`${days}_days`)}
                      </Button>
                    ))}
                  </div>
                  <div className="grid min-w-0 grid-cols-2 gap-2 [&_input]:min-w-0">
                    <InputField label={t("from")} type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
                    <InputField label={t("to")} type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
                  </div>
                </div>
              </div>
              <QueryBoundary query={analytics}>
                {(data) => (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card className="shadow-soft min-w-0"><CardContent><TrendChart title={t("user_registrations")} seriesName={t("registrations")} data={data.registrations} /></CardContent></Card>
                    <Card className="shadow-soft min-w-0"><CardContent><TrendChart title={t("enrollment_trend")} seriesName={t("enrollments")} data={data.enrollments} /></CardContent></Card>
                    <Card className="shadow-soft min-w-0"><CardContent><TrendChart title={t("learning_activity")} seriesName={t("events")} data={data.activity} /></CardContent></Card>
                    <Card className="shadow-soft min-w-0">
                      <CardContent>
                        {data.coursePopularity.length ? (
                          <PopularityChart title={t("course_popularity")} seriesName={t("enrollments")} data={data.coursePopularity} />
                        ) : (
                          <><p className="font-display mb-2 font-semibold">{t("course_popularity")}</p><p className="text-muted-foreground text-sm">{t("no_enrollments_yet")}</p></>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </QueryBoundary>
            </section>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="shadow-soft">
                <CardHeader><CardTitle className="font-display text-base">{t("content_overview")}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <ContentMeter label={t("courses")} published={metrics.publishedCourses} total={metrics.courses} />
                  <ContentMeter label={t("learning_modules")} published={metrics.publishedModules} total={metrics.modules} />
                </CardContent>
              </Card>
              <NotYetCard icon={<FileCheck aria-hidden />} title={t("ielts_assessments")} body={t("assessments_summary_note")} />
              <NotYetCard icon={<CreditCard aria-hidden />} title={t("payments")} body={t("payments_summary_note")} />
            </div>

            <section aria-labelledby="activity-heading">
              <h2 id="activity-heading" className="font-display mb-4 text-xl font-semibold">{t("recent_activity")}</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <ActivityCard title={t("recent_registrations")} empty={t("nothing_yet")} rows={activity.recentUsers.map((row) => ({ id: row.id, text: fullName(row.profile) || row.email, time: row.createdAt }))} />
                <ActivityCard title={t("recent_publications")} empty={t("nothing_yet")} rows={activity.recentPublications.map((row) => ({ id: row.id, text: row.course?.title ?? row.learningModule?.name ?? "-", time: row.createdAt }))} />
                <ActivityCard title={t("recent_enrollments")} empty={t("nothing_yet")} rows={activity.recentEnrollments.map((row) => ({ id: row.id, text: `${fullName(row.user?.profile)}: ${row.course.title}`, time: row.createdAt }))} />
                <ActivityCard title={t("administrative_actions")} empty={t("nothing_yet")} rows={activity.recentActions.map((row) => ({ id: row.id, text: `${row.action} (${fullName(row.actor?.profile) || labels.t("system")})`, time: row.createdAt }))} />
              </div>
            </section>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
