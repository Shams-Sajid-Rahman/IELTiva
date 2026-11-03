"use client";

import { ArrowRight, BookOpen, CalendarCheck, CheckCircle2, ClipboardCheck, Clock, Flame, GraduationCap, Headphones, History, Mic, PenLine, Target, User } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Stagger, StaggerItem } from "@/components/motion/reveal";
import { ProgressRing } from "@/components/feedback/progress-ring";
import { StatCard } from "@/components/feedback/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
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
type EnrollmentProgress = { id: string; status: string; course: { module: { name: string } }; progress: { total: number; completed: number } };
type ModuleRow = { id: string; name: string; skill: string | null };
type HistoryRow = { id: string; minutes: number | null; occurredAt: string };
type Preferences = { timezone: string; dailyGoalMinutes: number | null };

const SKILLS = [
  { skill: "LISTENING", icon: Headphones },
  { skill: "READING", icon: BookOpen },
  { skill: "WRITING", icon: PenLine },
  { skill: "SPEAKING", icon: Mic },
];
const DAY = 86_400_000;

const dayKey = (date: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

function Loading() {
  const t = useTranslations("app");
  return (
    <div role="status" aria-label={t("loading")} className="space-y-6">
      <Skeleton className="h-48 w-full rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-36 rounded-xl" />)}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-72 rounded-xl xl:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

/** Seven real days of recorded activity, ending today in the student's timezone. */
function StreakCard({ streakDays, activeDays, timeZone }: { streakDays: number; activeDays: Set<string>; timeZone: string }) {
  const t = useTranslations("app");
  const [now] = useState(() => Date.now());
  const days = Array.from({ length: 7 }, (_, index) => new Date(now - (6 - index) * DAY));
  return (
    <Card className="shadow-soft h-full">
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">{t("current_streak")}</p>
            <p className="font-display mt-1 text-3xl font-semibold">
              <AnimatedNumber value={streakDays} format={(value) => (value === 1 ? t("1_day") : t("count_days", { count: value }))} />
            </p>
          </div>
          <div className="bg-accent text-accent-foreground shrink-0 rounded-lg p-2 [&_svg]:size-5"><Flame aria-hidden /></div>
        </div>
        <ul aria-label={t("activity_in_the_last_7_days")} className="mt-4 grid grid-cols-7 gap-1.5">
          {days.map((day) => {
            const active = activeDays.has(dayKey(day, timeZone));
            const name = new Intl.DateTimeFormat("en", { weekday: "short", timeZone }).format(day);
            return (
              <li key={day.getTime()} className="text-center">
                <span aria-hidden className={cn("block h-7 rounded-md transition-colors", active ? "bg-primary" : "bg-muted")} />
                <span aria-hidden className="text-muted-foreground mt-1 block text-[0.6875rem]">{name.slice(0, 1)}</span>
                <span className="sr-only">{active ? t("day_active", { day: name }) : t("day_inactive", { day: name })}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function DailyGoalCard({ minutesToday, goal }: { minutesToday: number; goal: number | null }) {
  const t = useTranslations("app");
  const reached = goal !== null && minutesToday >= goal;
  return (
    <Card className="shadow-soft h-full">
      <CardContent className="flex h-full items-center gap-4">
        {goal ? (
          <>
            <ProgressRing value={(minutesToday / goal) * 100} label={t("daily_goal_progress", { minutes: minutesToday, goal })} size={84} barClassName={reached ? "stroke-success" : "stroke-primary"}>
              {reached ? <CheckCircle2 className="text-success size-6" aria-hidden /> : <Target className="text-primary size-6" aria-hidden />}
            </ProgressRing>
            <div className="min-w-0">
              <p className="text-muted-foreground text-sm">{t("daily_goal")}</p>
              <p className="font-display mt-1 text-xl font-semibold">{t("minutes_of_goal", { minutes: minutesToday, goal })}</p>
              <p className="text-muted-foreground mt-1 text-sm">{reached ? t("goal_reached_today") : t("logged_when_you_complete_a_lesson")}</p>
            </div>
          </>
        ) : (
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">{t("daily_goal")}</p>
            <p className="font-display mt-1 text-xl font-semibold">{t("set_a_daily_goal")}</p>
            <Link href="/settings" className="text-primary mt-2 inline-block text-sm font-medium underline underline-offset-4">{t("update_preferences")}</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Lessons completed per skill, from real course progress. This measures coverage, not ability, so it never shows a band. */
function SkillProgressCard() {
  const t = useTranslations("app");
  const labels = useLabels();
  const enrollments = useApiQuery<EnrollmentProgress[]>("/enrollments/me?pageSize=100");
  const modules = useApiQuery<ModuleRow[]>("/modules?pageSize=50");
  const skillOf = new Map((modules.data ?? []).map((row) => [row.name, row.skill]));
  const rows = SKILLS.map(({ skill, icon }) => {
    const matching = (enrollments.data ?? []).filter((row) => row.status !== "CANCELED" && skillOf.get(row.course.module.name) === skill);
    const total = matching.reduce((sum, row) => sum + row.progress.total, 0);
    const completed = matching.reduce((sum, row) => sum + row.progress.completed, 0);
    const moduleId = (modules.data ?? []).find((row) => row.skill === skill)?.id;
    return { skill, icon, total, completed, moduleId, percent: total ? Math.round((completed / total) * 100) : 0 };
  });

  return (
    <Card className="shadow-soft h-full">
      <CardHeader>
        <CardTitle className="font-display text-lg">{t("progress_by_skill")}</CardTitle>
        <p className="text-muted-foreground text-sm">{t("progress_by_skill_note")}</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-5">
          {rows.map(({ skill, icon: Icon, total, completed, percent, moduleId }) => (
            <li key={skill} className="flex items-center gap-3">
              <span className="bg-accent text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"><Icon className="size-4" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{labels.skill(skill)}</span>
                  {total ? (
                    <span className="text-muted-foreground tabular-nums">{t("completed_lessons", { completed, total })}</span>
                  ) : moduleId ? (
                    <Link href={`/courses?moduleId=${moduleId}`} className="text-primary font-medium underline-offset-4 hover:underline">{t("find_a_course", { skill: labels.skill(skill) })}</Link>
                  ) : (
                    <span className="text-muted-foreground">{t("no_course_yet")}</span>
                  )}
                </div>
                <Progress className="mt-2" value={percent} aria-label={t("progress_in_skill", { skill: labels.skill(skill) })} />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ActivityPanels({ stats }: { stats: StudentDashboard["stats"] }) {
  const t = useTranslations("app");
  const profile = useApiQuery<Preferences>("/profile/me");
  const history = useApiQuery<HistoryRow[]>("/history/me?pageSize=100");
  const timeZone = profile.data?.timezone ?? "UTC";
  const rows = history.data ?? [];
  const activeDays = new Set(rows.map((row) => dayKey(new Date(row.occurredAt), timeZone)));
  const today = dayKey(new Date(), timeZone);
  const minutesToday = rows.filter((row) => dayKey(new Date(row.occurredAt), timeZone) === today).reduce((sum, row) => sum + (row.minutes ?? 0), 0);

  return (
    <Stagger className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StaggerItem className="h-full"><StreakCard streakDays={stats.streakDays} activeDays={activeDays} timeZone={timeZone} /></StaggerItem>
      <StaggerItem className="h-full"><DailyGoalCard minutesToday={minutesToday} goal={profile.data?.dailyGoalMinutes ?? null} /></StaggerItem>
      <StaggerItem className="h-full">
        <StatCard label={t("completed_activities")} value={<AnimatedNumber value={stats.completedActivities} />} icon={<CheckCircle2 aria-hidden />} />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard label={t("practice_time")} value={<AnimatedNumber value={stats.loggedMinutes} format={formatMinutes} />} hint={t("time_logged_on_lessons")} icon={<Clock aria-hidden />} />
      </StaggerItem>
    </Stagger>
  );
}

const quickActions = [
  { href: "/courses", label: "browse_courses", icon: BookOpen },
  { href: "/practice", label: "ielts_practice", icon: Target },
  { href: "/planner", label: "study_planner", icon: CalendarCheck },
  { href: "/profile", label: "my_profile", icon: User },
];

export function StudentDashboard() {
  const t = useTranslations("app");
  const labels = useLabels();
  const query = useApiQuery<StudentDashboard>("/dashboard/student");
  const [now] = useState(() => Date.now());

  return (
    <QueryBoundary query={query} loading={<Loading />}>
      {({ profile, stats, enrollments, recentActivity, upcomingTasks, recommended }) => {
        const resume = enrollments.find((row) => row.status === "ACTIVE");
        const daysToExam = profile.examDate ? Math.ceil((new Date(profile.examDate).getTime() - now) / DAY) : null;
        return (
          <div className="space-y-6">
            <section className="bg-brand-surface relative overflow-hidden rounded-2xl p-6 sm:p-8">
              <div aria-hidden className="brand-grid absolute inset-0" />
              <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <h1 className="font-display text-2xl font-semibold tracking-tight break-words sm:text-4xl">{t("welcome_name", { name: profile.firstName || t("student_cd73") })}</h1>
                  <p className="text-on-brand-muted mt-2">
                    {profile.examType ? t("preparing_for_ielts_type", { type: labels.examType(profile.examType) }) : t("prepare_smarter_achieve_higher")}
                  </p>
                  {(profile.targetBand !== null || profile.examDate) && (
                    <ul className="mt-4 flex flex-wrap gap-2 text-sm">
                      {profile.targetBand !== null && <li className="bg-on-brand/10 rounded-full px-3 py-1">{t("target_band_band", { band: profile.targetBand.toFixed(1) })}</li>}
                      {profile.examDate && <li className="bg-on-brand/10 rounded-full px-3 py-1">{t("exam_on_date", { date: formatPlainDate(profile.examDate) })}</li>}
                      {daysToExam !== null && daysToExam > 0 && <li className="bg-on-brand/10 rounded-full px-3 py-1">{t("days_to_go", { count: daysToExam })}</li>}
                    </ul>
                  )}
                  <p className="text-on-brand-muted mt-3 flex flex-wrap gap-x-3 text-sm">
                    <span className="break-all">{profile.email}</span>
                    <span>{profile.emailVerified ? t("verified") : t("email_not_verified")}</span>
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {!profile.examType && (
                      <Button asChild variant="onBrand"><Link href="/settings">{t("choose_your_ielts_type")}</Link></Button>
                    )}
                    {resume && (
                      <Button asChild variant="onBrand">
                        <Link href={resume.lastResource ? `/courses/${resume.courseId}/resources/${resume.lastResource.id}` : `/courses/${resume.courseId}`}>
                          <span className="max-w-56 truncate">{t("resume_course", { course: resume.title })}</span> <ArrowRight aria-hidden />
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <ProgressRing value={stats.overallPercent} label={t("overall_progress")} size={112} stroke={10} trackClassName="stroke-on-brand/15" barClassName="stroke-brand-sky">
                    <p className="font-display text-2xl font-semibold"><AnimatedNumber value={stats.overallPercent} format={(value) => `${value}%`} /></p>
                  </ProgressRing>
                  <div>
                    <p className="font-medium">{t("overall_progress")}</p>
                    <p className="text-on-brand-muted text-sm">{t("across_enrolled_courses")}</p>
                  </div>
                </div>
              </div>
            </section>

            {!profile.emailVerified && (
              <p className="bg-card rounded-xl border p-4 text-sm">
                {t("please_verify_your_email")}{" "}
                <Link href="/verify-email" className="text-primary font-medium underline underline-offset-4">{t("resend_verification_email")}</Link>
              </p>
            )}

            <ActivityPanels stats={stats} />

            <div className="grid gap-6 xl:grid-cols-5">
              <div className="min-w-0 xl:col-span-3">
                <Card className="shadow-soft h-full">
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="font-display text-lg">{t("continue_learning")}</CardTitle>
                    <Button asChild variant="ghost" size="sm"><Link href="/learning">{t("view_all")} <ArrowRight aria-hidden /></Link></Button>
                  </CardHeader>
                  <CardContent>
                    {enrollments.length === 0 ? (
                      <Empty icon={<GraduationCap aria-hidden />} title={t("start_your_first_course")} description={t("your_enrolled_courses_and_progress_appear_here")} action={<Button asChild><Link href="/courses">{t("browse_courses")}</Link></Button>} />
                    ) : (
                      <ul className="divide-y">
                        {enrollments.map((row) => (
                          <li key={row.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                              <Link href={`/courses/${row.courseId}`} className="font-medium break-words underline-offset-4 hover:underline">{row.title}</Link>
                              <p className="text-muted-foreground text-sm">{row.moduleName}</p>
                              <Progress className="mt-2" value={row.progress.percent} aria-label={t("progress_in_course", { course: row.title })} />
                              <p className="text-muted-foreground mt-1 text-xs">{t("completed_of_total_completed", { completed: row.progress.completed, total: row.progress.total })}</p>
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
              </div>
              <div className="min-w-0 xl:col-span-2"><SkillProgressCard /></div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <Card className="shadow-soft">
                <CardHeader><CardTitle className="font-display text-lg">{t("upcoming_study_tasks")}</CardTitle></CardHeader>
                <CardContent>
                  {upcomingTasks.length === 0 ? (
                    <Empty icon={<CalendarCheck aria-hidden />} title={t("nothing_scheduled")} action={<Button asChild variant="outline"><Link href="/planner">{t("plan_your_study")}</Link></Button>} />
                  ) : (
                    <ul className="space-y-3">
                      {upcomingTasks.map((task) => (
                        <li key={task.id} className="text-sm">
                          <Link href="/planner" className="font-medium break-words underline-offset-4 hover:underline">{task.title}</Link>
                          <p className="text-muted-foreground">{formatPlainDate(task.scheduledDate)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-soft">
                <CardHeader><CardTitle className="font-display text-lg">{t("exam_history")}</CardTitle></CardHeader>
                <CardContent>
                  <Empty icon={<ClipboardCheck aria-hidden />} title={t("no_exams_yet")} description={t("exam_history_note")} action={<Button asChild variant="outline"><Link href="/practice">{t("preview_the_exam_screens")}</Link></Button>} />
                </CardContent>
              </Card>

              <Card className="shadow-soft md:col-span-2 xl:col-span-1">
                <CardHeader><CardTitle className="font-display text-lg">{t("quick_actions")}</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  {quickActions.map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} className="lift bg-background flex min-h-24 flex-col justify-between gap-2 rounded-xl border p-3 text-sm font-medium">
                      <Icon className="text-primary size-5" aria-hidden />
                      {t(label)}
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-soft">
              <CardHeader><CardTitle className="font-display text-lg">{t("recent_activity")}</CardTitle></CardHeader>
              <CardContent>
                {recentActivity.length === 0 ? (
                  <Empty icon={<History aria-hidden />} title={t("no_activity_yet")} description={t("your_lessons_and_completed_work_appear_here")} />
                ) : (
                  <ul className="divide-y">
                    {recentActivity.map((item) => (
                      <li key={item.id} className="flex flex-col gap-0.5 py-2.5 text-sm first:pt-0 last:pb-0 sm:flex-row sm:justify-between sm:gap-4">
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

            {recommended.length > 0 && (
              <section aria-labelledby="recommended">
                <h2 id="recommended" className="font-display mb-3 text-lg font-semibold">{t("recommended_courses")}</h2>
                <div className="grid gap-4 md:grid-cols-3">
                  {recommended.map((course) => (
                    <Card key={course.id} className="lift shadow-soft">
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
        );
      }}
    </QueryBoundary>
  );
}
