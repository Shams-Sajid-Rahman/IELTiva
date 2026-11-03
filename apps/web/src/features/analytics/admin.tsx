"use client";

import { Bot, BookOpen, CreditCard, GraduationCap, Target, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { StatCard } from "@/components/feedback/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "../billing/money";
import { useApiQuery } from "../platform/hooks";
import { useLabels } from "../platform/labels";
import { PopularityChart, TrendChart } from "../platform/admin/charts";
import { Empty, PageHeader, QueryBoundary, SelectBox, TableFrame, tdClass, thClass } from "../platform/ui";

type Day = { day: string; count: number };
type Overview = {
  days: number;
  minGroupSize: number;
  activity: { activeToday: number; activeWeek: number; activeMonth: number; totalStudents: number; newStudents: number; signups: Day[]; dailyActive: Day[] };
  enrollments: { active: number; completed: number; canceled: number; new: number; topCourses: { title: string; count: number }[] };
  practice: { started: number; submitted: number; timedOut: number; abandoned: number; mocks: number; completionRate: number | null; series: Day[]; skills: { skill: string; sections: number; minutes: number; withheld: boolean; averageAccuracy: number | null }[]; topExams: { title: string; count: number }[] };
  assessments: { total: number; failed: number; failureRate: number | null; averageSeconds: number | null; tutorMessages: number; series: Day[]; byTask: { taskKey: string; completed: number; failed: number; open: number }[] };
  packages: { expiringSoon: number; features: { featureKey: string; activeEntitlements: number; usedInPeriod: number }[] };
  revenue: { currencies: { currency: string; grossMinor: number; refundedMinor: number; netMinor: number; payments: number }[]; pendingRefunds: number } | null;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function View({ data }: { data: Overview }) {
  const t = useTranslations("analytics.admin");
  const billing = useTranslations("billing");
  const labels = useLabels();
  return (
    <div className="space-y-10">
      <p className="bg-card rounded-xl border p-4 text-sm">{t("privacyNote", { size: data.minGroupSize })}</p>

      <Section title={t("activityTitle")}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t("students")} value={data.activity.totalStudents} hint={t("newInPeriod", { count: data.activity.newStudents })} icon={<Users aria-hidden />} />
          <StatCard label={t("activeToday")} value={data.activity.activeToday} icon={<Users aria-hidden />} />
          <StatCard label={t("activeWeek")} value={data.activity.activeWeek} icon={<Users aria-hidden />} />
          <StatCard label={t("activeMonth")} value={data.activity.activeMonth} icon={<Users aria-hidden />} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="shadow-soft"><CardContent><TrendChart title={t("dailyActive")} seriesName={t("activeUsers")} data={data.activity.dailyActive} /></CardContent></Card>
          <Card className="shadow-soft"><CardContent><TrendChart title={t("signups")} seriesName={t("signupsName")} data={data.activity.signups} /></CardContent></Card>
        </div>
      </Section>

      <Section title={t("enrollmentsTitle")}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t("enrollActive")} value={data.enrollments.active} icon={<GraduationCap aria-hidden />} />
          <StatCard label={t("enrollCompleted")} value={data.enrollments.completed} icon={<GraduationCap aria-hidden />} />
          <StatCard label={t("enrollCanceled")} value={data.enrollments.canceled} icon={<GraduationCap aria-hidden />} />
          <StatCard label={t("enrollNew")} value={data.enrollments.new} icon={<BookOpen aria-hidden />} />
        </div>
        {data.enrollments.topCourses.length > 0 && <Card className="shadow-soft"><CardContent><PopularityChart title={t("topCourses")} seriesName={t("enrollmentsName")} data={data.enrollments.topCourses} /></CardContent></Card>}
      </Section>

      <Section title={t("practiceTitle")}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t("attempts")} value={data.practice.started} hint={t("mocks", { count: data.practice.mocks })} icon={<Target aria-hidden />} />
          <StatCard label={t("completion")} value={data.practice.completionRate !== null ? `${data.practice.completionRate}%` : "-"} hint={t("completionHint", { submitted: data.practice.submitted, timedOut: data.practice.timedOut, abandoned: data.practice.abandoned })} icon={<Target aria-hidden />} />
        </div>
        <Card className="shadow-soft"><CardContent><TrendChart title={t("attemptsDaily")} seriesName={t("attempts")} data={data.practice.series} /></CardContent></Card>
        {data.practice.skills.length > 0 && (
          <TableFrame label={t("bySkill")}>
            <thead><tr>{[t("skill"), t("sections"), t("minutes"), t("averageAccuracy")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
            <tbody>{data.practice.skills.map((row) => <tr key={row.skill}><td className={tdClass}>{labels.skill(row.skill)}</td><td className={tdClass}>{row.sections}</td><td className={tdClass}>{row.minutes}</td><td className={tdClass}>{row.withheld ? <span className="text-muted-foreground">{t("withheld")}</span> : row.averageAccuracy !== null ? `${row.averageAccuracy}%` : "-"}</td></tr>)}</tbody>
          </TableFrame>
        )}
        {data.practice.topExams.length > 0 && <Card className="shadow-soft"><CardContent><PopularityChart title={t("topExams")} seriesName={t("attempts")} data={data.practice.topExams} /></CardContent></Card>}
      </Section>

      <Section title={t("assessmentsTitle")}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t("aiJobs")} value={data.assessments.total} hint={t("failedHint", { count: data.assessments.failed })} icon={<Bot aria-hidden />} />
          <StatCard label={t("failureRate")} value={data.assessments.failureRate !== null ? `${data.assessments.failureRate}%` : "-"} icon={<Bot aria-hidden />} />
          <StatCard label={t("turnaround")} value={data.assessments.averageSeconds !== null ? t("seconds", { count: data.assessments.averageSeconds }) : "-"} icon={<Bot aria-hidden />} />
          <StatCard label={t("tutorMessages")} value={data.assessments.tutorMessages} icon={<Bot aria-hidden />} />
        </div>
        {data.assessments.byTask.length > 0 && (
          <TableFrame label={t("byTask")}>
            <thead><tr>{[t("task"), t("done"), t("failed"), t("open")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
            <tbody>{data.assessments.byTask.map((row) => <tr key={row.taskKey}><td className={tdClass}>{row.taskKey}</td><td className={tdClass}>{row.completed}</td><td className={tdClass}>{row.failed}</td><td className={tdClass}>{row.open}</td></tr>)}</tbody>
          </TableFrame>
        )}
      </Section>

      <Section title={t("packagesTitle")}>
        {data.packages.features.length === 0 ? (
          <Empty title={t("noPackageUse")} />
        ) : (
          <>
            <p className="text-muted-foreground text-sm">{t("expiringSoon", { count: data.packages.expiringSoon })}</p>
            <TableFrame label={t("packagesTitle")}>
              <thead><tr>{[t("feature"), t("activeHolders"), t("usedInPeriod")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
              <tbody>{data.packages.features.map((row) => <tr key={row.featureKey}><td className={tdClass}>{billing.has(`features.${row.featureKey}`) ? billing(`features.${row.featureKey}`) : row.featureKey}</td><td className={tdClass}>{row.activeEntitlements}</td><td className={tdClass}>{row.usedInPeriod}</td></tr>)}</tbody>
            </TableFrame>
          </>
        )}
      </Section>

      {data.revenue && (
        <Section title={t("revenueTitle")}>
          {data.revenue.currencies.length === 0 ? (
            <Empty title={t("noRevenue")} icon={<CreditCard aria-hidden />} />
          ) : (
            <TableFrame label={t("revenueTitle")}>
              <thead><tr>{[t("currency"), t("gross"), t("refunds"), t("net"), t("payments")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
              <tbody>{data.revenue.currencies.map((row) => <tr key={row.currency}><td className={tdClass}>{row.currency}</td><td className={tdClass}>{formatMoney(row.grossMinor, row.currency)}</td><td className={tdClass}>{formatMoney(row.refundedMinor, row.currency)}</td><td className={tdClass}>{formatMoney(row.netMinor, row.currency)}</td><td className={tdClass}>{row.payments}</td></tr>)}</tbody>
            </TableFrame>
          )}
        </Section>
      )}
    </div>
  );
}

export function AdminAnalyticsPage() {
  const t = useTranslations("analytics.admin");
  const [days, setDays] = useState("30");
  const query = useApiQuery<Overview>(`/admin/analytics?days=${days}`);
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} actions={<SelectBox hideLabel label={t("period")} className="w-40" value={days} onChange={(event) => setDays(event.target.value)} options={["7", "30", "90", "365"].map((value) => ({ value, label: t("lastDays", { days: value }) }))} />} />
      <QueryBoundary query={query}>{(data) => <View data={data} />}</QueryBoundary>
    </>
  );
}
