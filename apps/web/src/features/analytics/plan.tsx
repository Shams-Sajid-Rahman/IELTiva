"use client";

import { ArrowRight, Bell, CalendarPlus, Lightbulb, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { api, ApiRequestError } from "@/lib/api-client";
import { ConsentButton, useConsents } from "../ai/consent";
import { formatMinutes, formatPlainDate } from "../platform/format";
import { useApiAction, useApiQuery } from "../platform/hooks";
import { useLabels } from "../platform/labels";
import { Empty, InputField, QueryBoundary, SelectBox } from "../platform/ui";

type Goals = { targetBand: number | null; examDate: string | null; dailyGoalMinutes: number | null; weeklySessionGoal: number | null; remindersEnabled: boolean; reminderTime: string | null; reminderDays: number[] };
type GoalState = { goals: Goals; timeZone: string; progress: { todayMinutes: number; weekMinutes: number; weekSessions: number; weekTasks: number; weekTasksDone: number } };
type Recommendation = { id: string; kind: string; skill: string | null; evidence: Record<string, string | number>; action: { type: string; href: string; label: string | null } };
type Plan = { dailyMinutes: number; horizonDays: number; shares: { skill: string; accuracy: number | null; percent: number; tasks: number }[]; tasks: { date: string; skill: string | null; title: string; minutes: number; examId: string | null; reason: { kind: string; accuracy?: number } }[] };

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const BANDS = Array.from({ length: 17 }, (_, index) => (index + 2) / 2).map((value) => value.toFixed(1));

function GoalBar({ label, value, goal, format }: { label: string; value: number; goal: number; format: (value: number) => string }) {
  const percent = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm"><span>{label}</span><span className="font-medium tabular-nums">{format(value)} / {format(goal)}</span></div>
      <Progress value={percent} className="mt-1" aria-label={label} />
    </div>
  );
}

function GoalsCard({ state }: { state: GoalState }) {
  const t = useTranslations("analytics.plan");
  const { goals, progress } = state;
  const [form, setForm] = useState({
    targetBand: goals.targetBand?.toFixed(1) ?? "",
    examDate: goals.examDate ?? "",
    daily: goals.dailyGoalMinutes ? String(goals.dailyGoalMinutes) : "",
    weekly: goals.weeklySessionGoal ? String(goals.weeklySessionGoal) : "",
    reminders: goals.remindersEnabled,
    time: goals.reminderTime ?? "18:00",
    days: goals.reminderDays,
  });
  const save = useApiAction((body: Goals) => api.put("/analytics/goals", body), t("saved"));
  const weekdayName = (day: number) => new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + day)));

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({
      targetBand: form.targetBand ? Number(form.targetBand) : null,
      examDate: form.examDate || null,
      dailyGoalMinutes: form.daily ? Number(form.daily) : null,
      weeklySessionGoal: form.weekly ? Number(form.weekly) : null,
      remindersEnabled: form.reminders,
      reminderTime: form.reminders ? form.time : null,
      reminderDays: form.reminders ? form.days : [],
    });
  }

  return (
    <Card className="shadow-soft">
      <CardHeader><CardTitle className="font-display flex items-center gap-2 text-lg"><Target className="size-5" aria-hidden /> {t("goalsTitle")}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        {(goals.dailyGoalMinutes || goals.weeklySessionGoal || progress.weekTasks > 0) ? (
          <div className="space-y-3">
            {goals.dailyGoalMinutes && <GoalBar label={t("today")} value={progress.todayMinutes} goal={goals.dailyGoalMinutes} format={formatMinutes} />}
            {goals.weeklySessionGoal && <GoalBar label={t("thisWeekSessions")} value={progress.weekSessions} goal={goals.weeklySessionGoal} format={String} />}
            {progress.weekTasks > 0 && <GoalBar label={t("thisWeekTasks")} value={progress.weekTasksDone} goal={progress.weekTasks} format={String} />}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noGoals")}</p>
        )}
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectBox label={t("targetBand")} value={form.targetBand} onChange={(event) => setForm({ ...form, targetBand: event.target.value })} options={[{ value: "", label: t("notSet") }, ...BANDS.map((value) => ({ value, label: value }))]} />
            <InputField label={t("examDate")} type="date" value={form.examDate} onChange={(event) => setForm({ ...form, examDate: event.target.value })} />
            <InputField label={t("dailyMinutes")} type="number" min={5} max={600} value={form.daily} onChange={(event) => setForm({ ...form, daily: event.target.value })} />
            <InputField label={t("weeklySessions")} type="number" min={1} max={50} value={form.weekly} onChange={(event) => setForm({ ...form, weekly: event.target.value })} />
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={form.reminders} onCheckedChange={(value) => setForm({ ...form, reminders: value })} /> <Bell className="size-4" aria-hidden /> {t("reminders")}</label>
            {form.reminders && (
              <div className="flex flex-wrap items-end gap-4">
                <InputField label={t("reminderTime", { zone: state.timeZone })} type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} />
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">{t("reminderDays")}</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((day) => (
                      <label key={day} className="has-[:checked]:bg-primary has-[:checked]:text-primary-foreground flex cursor-pointer items-center rounded-md border px-2 py-1 text-xs pointer-coarse:px-3 pointer-coarse:py-2">
                        <input type="checkbox" className="sr-only" checked={form.days.includes(day)} onChange={(event) => setForm({ ...form, days: event.target.checked ? [...form.days, day] : form.days.filter((entry) => entry !== day) })} />
                        {weekdayName(day)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            )}
          </div>
          <Button type="submit" disabled={save.isPending}>{t("saveGoals")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Rule-based suggestions, each with the numbers behind it. AI can put them into words, but it doesn't choose them. */
export function Recommendations() {
  const t = useTranslations("analytics.recommendations");
  const types = useTranslations("examAdmin.types");
  const criteria = useTranslations("ai.report.criteria");
  const labels = useLabels();
  const consents = useConsents();
  const query = useApiQuery<Recommendation[]>("/analytics/recommendations");
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function explain() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ text: string | null }>("/analytics/recommendations/explain");
      setExplanation(result.text);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : t("explainFailed"));
    } finally {
      setBusy(false);
    }
  }

  const message = (item: Recommendation) => {
    const values: Record<string, string | number> = { ...item.evidence, skill: labels.skill(item.skill) };
    if (typeof item.evidence.type === "string") values.type = types.has(item.evidence.type) ? types(item.evidence.type) : item.evidence.type;
    if (typeof item.evidence.criterion === "string") values.criterion = criteria.has(item.evidence.criterion) ? criteria(item.evidence.criterion) : item.evidence.criterion;
    if (typeof item.evidence.average === "number") values.average = item.evidence.average.toFixed(1);
    if (typeof item.evidence.target === "number") values.target = item.evidence.target.toFixed(1);
    return { title: t(`${item.kind}.title`, values), why: t(`${item.kind}.why`, values) };
  };

  return (
    <QueryBoundary query={query}>
      {(items) =>
        items.length === 0 ? (
          <Empty title={t("none")} description={t("noneHint")} icon={<Lightbulb aria-hidden />} />
        ) : (
          <div className="space-y-4">
            <ul className="grid gap-3 md:grid-cols-2">
              {items.map((item) => {
                const text = message(item);
                return (
                  <li key={item.id} className="bg-card shadow-soft flex flex-col gap-2 rounded-xl border p-4">
                    <p className="font-medium">{text.title}</p>
                    <p className="text-muted-foreground text-sm">{text.why}</p>
                    <Link href={item.action.href} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-auto w-fit max-w-full" })}>
                      <span className="truncate">{item.action.label ?? t(`actions.${item.action.type}`)}</span> <ArrowRight aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
            {consents.data?.tutorAvailable && (
              <div className="bg-muted space-y-2 rounded-lg p-4 text-sm">
                {explanation ? (
                  <>
                    <p className="flex items-center gap-1.5 font-medium"><Sparkles className="size-4" aria-hidden /> {t("aiTitle")}</p>
                    <p className="leading-relaxed whitespace-pre-wrap">{explanation}</p>
                    <p className="text-muted-foreground text-xs">{t("aiNote")}</p>
                  </>
                ) : (
                  <ConsentButton types={["AI_PROCESSING"]} variant="outline" disabled={busy} label={<><Sparkles aria-hidden /> {busy ? t("explaining") : t("explain")}</>} onReady={() => void explain()} />
                )}
                {error && <p role="alert" className="text-destructive">{error}</p>}
              </div>
            )}
          </div>
        )
      }
    </QueryBoundary>
  );
}

function SuggestedSchedule() {
  const t = useTranslations("analytics.plan");
  const labels = useLabels();
  const [days, setDays] = useState("14");
  const query = useApiQuery<Plan>(`/analytics/study-plan?days=${days}`);
  const apply = useApiAction(() => api.post<{ added: number }>("/analytics/study-plan/apply", { days: Number(days) }), t("planAdded"));
  return (
    <Card className="shadow-soft">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="font-display flex items-center gap-2 text-lg"><CalendarPlus className="size-5" aria-hidden /> {t("suggestedTitle")}</CardTitle>
        <SelectBox hideLabel label={t("planLength")} className="w-36" value={days} onChange={(event) => setDays(event.target.value)} options={["7", "14", "21", "28"].map((value) => ({ value, label: t("nextDays", { days: value }) }))} />
      </CardHeader>
      <CardContent>
        <QueryBoundary query={query}>
          {(plan) =>
            plan.tasks.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noPlan")}</p>
            ) : (
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">{t("planIntro", { minutes: plan.dailyMinutes })}</p>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {plan.shares.map((share) => (
                    <li key={share.skill} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">{labels.skill(share.skill)}</p>
                      <p className="text-muted-foreground">{t("shareTasks", { count: share.tasks })}</p>
                      <p className="text-muted-foreground text-xs">{share.accuracy !== null ? t("shareAccuracy", { accuracy: share.accuracy }) : t("shareNoData")}</p>
                    </li>
                  ))}
                </ul>
                <details className="rounded-lg border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">{t("seeTasks", { count: plan.tasks.length })}</summary>
                  <ul className="mt-2 divide-y">
                    {plan.tasks.map((task, index) => (
                      <li key={`${task.date}-${index}`} className="flex flex-wrap justify-between gap-2 py-2">
                        <span className="min-w-0 break-words">{task.title}</span>
                        <span className="text-muted-foreground shrink-0">{formatPlainDate(task.date)} · {formatMinutes(task.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
                <Button disabled={apply.isPending} onClick={() => apply.mutate()}>{t("addToPlanner")}</Button>
              </div>
            )
          }
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

/** Goals, suggestions and a suggested schedule, shown above the student's own task list. */
export function PersonalPlan() {
  const t = useTranslations("analytics.plan");
  const goals = useApiQuery<GoalState>("/analytics/goals");
  return (
    <div className="mb-8 space-y-6">
      <QueryBoundary query={goals}>{(state) => <GoalsCard state={state} />}</QueryBoundary>
      <section aria-labelledby="plan-recs">
        <h2 id="plan-recs" className="font-display mb-3 text-xl font-semibold">{t("recommendedTitle")}</h2>
        <Recommendations />
      </section>
      <SuggestedSchedule />
      <h2 className="font-display text-xl font-semibold">{t("yourTasks")}</h2>
    </div>
  );
}
