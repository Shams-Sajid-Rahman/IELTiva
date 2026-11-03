"use client";

import { ArrowRight, BookOpen, CalendarCheck, CheckCircle2, Clock, Flame, GraduationCap, History, Target, TrendingUp, User } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Stagger, StaggerItem } from "@/components/motion/reveal";
import { StatCard } from "@/components/feedback/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatMinutes, formatPlainDate } from "../format";
import { useApiQuery } from "../hooks";
import { useLabels } from "../labels";
import { Empty, QueryBoundary } from "../ui";

type StudentDashboard = {
  profile: { firstName: string; lastName: string; email: string; emailVerified: boolean; examType: string | null; targetBand: number | null; examDate: string | null; memberSince: string };
  stats: { overallPercent: number; completedActivities: number; loggedMinutes: number; streakDays: number; enrolledCourses: number; unreadNotifications: number };
  enrollments: { id: string; courseId: string; status: string; title: string; moduleName: string; lastResource: { id: string; title: string } | null; progress: { total: number; completed: number; percent: number } }[];
  recentActivity: { id: string; eventType: string; occurredAt: string; course: { id: string; title: string } | null; resource: { id: string; title: string } | null }[];
  upcomingTasks: { id: string; title: string; skill: string | null; scheduledDate: string; estimatedMinutes: number | null }[];
  recommended: { id: string; title: string; description: string | null; difficulty: string | null; estimatedMinutes: number | null; isPremium: boolean; module: { name: string } }[];
};

function Loading() {
  const t = useTranslations("app");
  return (
    <div role="status" aria-label={t("loading")} className="space-y-4">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

export function StudentDashboard() {
  const t = useTranslations("app");
  const labels = useLabels();
  const query = useApiQuery<StudentDashboard>("/dashboard/student");

  return (
    <QueryBoundary query={query} loading={<Loading />}>
      {({ profile, stats, enrollments, recentActivity, upcomingTasks, recommended }) => (
        <div className="space-y-6">
          <section className="bg-primary text-primary-foreground rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-bold break-words sm:text-3xl">{t("welcome_name", { name: profile.firstName || t("student_cd73") })}</h1>
                <p className="mt-1 opacity-90">
                  {profile.examType ? t("preparing_for_ielts_type", { type: labels.examType(profile.examType) }) : t("prepare_smarter_achieve_higher")}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm opacity-90">
                  {profile.targetBand !== null && <span>{t("target_band_band", { band: profile.targetBand.toFixed(1) })}</span>}
                  {profile.examDate && <span>{t("exam_on_date", { date: formatPlainDate(profile.examDate) })}</span>}
                  <span>{profile.email}</span>
                  <span>{profile.emailVerified ? t("verified") : t("email_not_verified")}</span>
                </div>
              </div>
              {!profile.examType && (
                <Button asChild variant="secondary">
                  <Link href="/settings">{t("choose_your_ielts_type")}</Link>
                </Button>
              )}
            </div>
          </section>

          {!profile.emailVerified && (
            <p className="bg-card rounded-xl border p-4 text-sm">
              {t("please_verify_your_email")}{" "}
              <Link href="/verify-email" className="text-primary font-medium underline underline-offset-4">
                {t("resend_verification_email")}
              </Link>
            </p>
          )}

          <Stagger className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StaggerItem className="h-full">
              <StatCard label={t("overall_progress")} value={`${stats.overallPercent}%`} hint={t("across_enrolled_courses")} icon={<TrendingUp aria-hidden />} />
            </StaggerItem>
            <StaggerItem className="h-full">
              <StatCard label={t("completed_activities")} value={stats.completedActivities} icon={<CheckCircle2 aria-hidden />} />
            </StaggerItem>
            <StaggerItem className="h-full">
              <StatCard label={t("practice_time")} value={formatMinutes(stats.loggedMinutes)} hint={t("time_logged_on_lessons")} icon={<Clock aria-hidden />} />
            </StaggerItem>
            <StaggerItem className="h-full">
              <StatCard label={t("current_streak")} value={stats.streakDays === 1 ? t("1_day") : t("count_days", { count: stats.streakDays })} hint={t("days_in_a_row_with_activity")} icon={<Flame aria-hidden />} />
            </StaggerItem>
          </Stagger>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="shadow-soft xl:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="font-display text-lg">{t("continue_learning")}</CardTitle>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/learning">
                    {t("view_all")} <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {enrollments.length === 0 ? (
                  <Empty
                    icon={<GraduationCap aria-hidden />}
                    title={t("start_your_first_course")}
                    description={t("your_enrolled_courses_and_progress_appear_here")}
                    action={
                      <Button asChild>
                        <Link href="/courses">{t("browse_courses")}</Link>
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y">
                    {enrollments.map((row) => (
                      <li key={row.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <Link href={`/courses/${row.courseId}`} className="font-medium break-words underline-offset-4 hover:underline">
                            {row.title}
                          </Link>
                          <p className="text-muted-foreground text-sm">{row.moduleName}</p>
                          <Progress className="mt-2" value={row.progress.percent} aria-label={t("progress_in_course", { course: row.title })} />
                          <p className="text-muted-foreground mt-1 text-xs">
                            {t("completed_of_total_completed", { completed: row.progress.completed, total: row.progress.total })}
                          </p>
                        </div>
                        <Button asChild variant="outline" size="sm">
                          <Link href={row.lastResource ? `/courses/${row.courseId}/resources/${row.lastResource.id}` : `/courses/${row.courseId}`}>{t("continue")}</Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-soft">
              <CardHeader>
                <CardTitle className="font-display text-lg">{t("upcoming_study_tasks")}</CardTitle>
              </CardHeader>
              <CardContent>
                {upcomingTasks.length === 0 ? (
                  <Empty
                    icon={<CalendarCheck aria-hidden />}
                    title={t("nothing_scheduled")}
                    action={
                      <Button asChild variant="outline">
                        <Link href="/planner">{t("plan_your_study")}</Link>
                      </Button>
                    }
                  />
                ) : (
                  <ul className="space-y-3">
                    {upcomingTasks.map((task) => (
                      <li key={task.id} className="text-sm">
                        <Link href="/planner" className="font-medium break-words underline-offset-4 hover:underline">
                          {task.title}
                        </Link>
                        <p className="text-muted-foreground">{formatPlainDate(task.scheduledDate)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="shadow-soft xl:col-span-2">
              <CardHeader>
                <CardTitle className="font-display text-lg">{t("recent_activity")}</CardTitle>
              </CardHeader>
              <CardContent>
                {recentActivity.length === 0 ? (
                  <Empty icon={<History aria-hidden />} title={t("no_activity_yet")} description={t("your_lessons_and_completed_work_appear_here")} />
                ) : (
                  <ul className="divide-y">
                    {recentActivity.map((item) => (
                      <li key={item.id} className="flex flex-col gap-0.5 py-2 text-sm first:pt-0 sm:flex-row sm:justify-between sm:gap-4">
                        <span className="min-w-0 break-words">
                          {labels.event(item.eventType)}
                          {(item.resource ?? item.course) && <span className="text-muted-foreground">: {item.resource?.title ?? item.course?.title}</span>}
                        </span>
                        <time className="text-muted-foreground shrink-0">{formatDateTime(item.occurredAt)}</time>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-soft">
              <CardHeader>
                <CardTitle className="font-display text-lg">{t("quick_actions")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/courses"><BookOpen aria-hidden /> {t("browse_courses")}</Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/practice"><Target aria-hidden /> {t("ielts_practice")}</Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/planner"><CalendarCheck aria-hidden /> {t("study_planner")}</Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/profile"><User aria-hidden /> {t("my_profile")}</Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          {recommended.length > 0 && (
            <section aria-labelledby="recommended">
              <h2 id="recommended" className="font-display mb-3 text-lg font-semibold">{t("recommended_courses")}</h2>
              <div className="grid gap-4 md:grid-cols-3">
                {recommended.map((course) => (
                  <Card key={course.id} className="shadow-soft">
                    <CardHeader>
                      <CardTitle className="font-display text-base break-words">
                        <Link href={`/courses/${course.id}`} className="underline-offset-4 hover:underline">{course.title}</Link>
                      </CardTitle>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="secondary">{course.module.name}</Badge>
                        {course.difficulty && <Badge variant="outline">{labels.difficulty(course.difficulty)}</Badge>}
                        {course.isPremium && <Badge variant="outline">{t("premium")}</Badge>}
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </QueryBoundary>
  );
}
