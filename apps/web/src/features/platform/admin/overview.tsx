"use client";

import { BookOpen, GraduationCap, Layers, UserCheck, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { StatCard } from "@/components/feedback/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
          <ul className="space-y-2 text-sm">
            {rows.map((row) => (
              <li key={row.id}>
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

const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

export function AdminOverview() {
  const t = useTranslations("app");
  const labels = useLabels();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const allowed = hasPermission("dashboard.admin");
  const [from, setFrom] = useState(() => isoDaysAgo(29));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const dashboard = useApiQuery<AdminDashboard>("/dashboard/admin", { enabled: allowed });
  const analytics = useApiQuery<Analytics>(`/dashboard/analytics?from=${from}&to=${to}`, { enabled: allowed && Boolean(from && to) });

  // Instructors and editors work in the course area.
  useEffect(() => {
    if (!allowed) router.replace("/admin/courses");
  }, [allowed, router]);
  if (!allowed) return <LoadingBlocks />;

  const preset = (days: number) => {
    setFrom(isoDaysAgo(days - 1));
    setTo(isoDaysAgo(0));
  };

  return (
    <>
      <PageHeader title={t("administration")} description={t("live_figures_from_the_platform_database")} />
      <QueryBoundary query={dashboard}>
        {({ metrics, activity }) => (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard label={t("registered_users")} value={metrics.totalUsers} hint={t("students_students_instructors_instructors", { students: metrics.students, instructors: metrics.instructors })} icon={<Users aria-hidden />} />
              <StatCard label={t("active_users")} value={metrics.activeUsers} hint={t("signed_in_during_the_last_30_days")} icon={<UserCheck aria-hidden />} />
              <StatCard label={t("new_users")} value={metrics.newUsers} hint={t("joined_in_the_last_30_days")} icon={<UserPlus aria-hidden />} />
              <StatCard label={t("courses")} value={metrics.courses} hint={t("count_published", { count: metrics.publishedCourses })} icon={<BookOpen aria-hidden />} />
              <StatCard label={t("learning_modules")} value={metrics.modules} hint={t("count_published", { count: metrics.publishedModules })} icon={<Layers aria-hidden />} />
              <StatCard label={t("enrollments")} value={metrics.enrollments} hint={t("excludes_canceled_enrollments")} icon={<GraduationCap aria-hidden />} />
            </div>
            <section aria-labelledby="analytics-heading">
              <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <h2 id="analytics-heading" className="font-display text-lg font-semibold">{t("trends")}</h2>
                <div className="flex flex-wrap items-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => preset(7)}>{t("7_days")}</Button>
                  <Button variant="outline" size="sm" onClick={() => preset(30)}>{t("30_days")}</Button>
                  <Button variant="outline" size="sm" onClick={() => preset(90)}>{t("90_days")}</Button>
                  <InputField label={t("from")} type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
                  <InputField label={t("to")} type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
                </div>
              </div>
              <QueryBoundary query={analytics}>
                {(data) => (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card className="shadow-soft"><CardContent><TrendChart title={t("user_registrations")} seriesName={t("registrations")} data={data.registrations} /></CardContent></Card>
                    <Card className="shadow-soft"><CardContent><TrendChart title={t("enrollment_trend")} seriesName={t("enrollments")} data={data.enrollments} /></CardContent></Card>
                    <Card className="shadow-soft"><CardContent><TrendChart title={t("learning_activity")} seriesName={t("events")} data={data.activity} /></CardContent></Card>
                    <Card className="shadow-soft">
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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <ActivityCard
                title={t("recent_registrations")}
                empty={t("nothing_yet")}
                rows={activity.recentUsers.map((row) => ({ id: row.id, text: fullName(row.profile) || row.email, time: row.createdAt }))}
              />
              <ActivityCard
                title={t("recent_publications")}
                empty={t("nothing_yet")}
                rows={activity.recentPublications.map((row) => ({ id: row.id, text: row.course?.title ?? row.learningModule?.name ?? "-", time: row.createdAt }))}
              />
              <ActivityCard
                title={t("recent_enrollments")}
                empty={t("nothing_yet")}
                rows={activity.recentEnrollments.map((row) => ({ id: row.id, text: `${fullName(row.user?.profile)}: ${row.course.title}`, time: row.createdAt }))}
              />
              <ActivityCard
                title={t("administrative_actions")}
                empty={t("nothing_yet")}
                rows={activity.recentActions.map((row) => ({ id: row.id, text: `${row.action} (${fullName(row.actor?.profile) || labels.t("system")})`, time: row.createdAt }))}
              />
            </div>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
