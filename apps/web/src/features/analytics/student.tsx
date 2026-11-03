"use client";

import { BarChart3, CalendarDays, CheckCircle2, Clock, Flame, Info, Target } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { StatCard } from "@/components/feedback/stat-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatMinutes } from "../platform/format";
import { useApiPage, useApiQuery } from "../platform/hooks";
import { useLabels } from "../platform/labels";
import { Empty, PageHeader, Pagination, QueryBoundary, SelectBox, TableFrame, tdClass, thClass } from "../platform/ui";
import { ActivityCalendar, KindBadge, PercentBars, SKILL_COLORS, TrendLines } from "./charts";
import { Recommendations } from "./plan";
import { ProgressReports } from "./reports";

type Skill = { skill: string; sectionsCompleted: number; sectionsTimedOut: number; rawScore: number | null; maxScore: number | null; accuracy: number | null; minutes: number; lastPracticedAt: string | null };
type Analytics = {
  days: number;
  timeZone: string;
  overview: { attemptsStarted: number; attemptsFinished: number; attemptsTimedOut: number; attemptsAbandoned: number; mockTests: number; completionRate: number | null; rawScore: number | null; maxScore: number | null; accuracy: number | null; minutes: number; activeDays: number; currentStreak: number; longestStreak: number };
  skills: Skill[];
  weekly: { week: string; skill: string; accuracy: number; sections: number }[];
  questionTypes: { type: string; skill: string; total: number; correct: number; accuracy: number; enoughData: boolean }[];
  activity: { day: string; minutes: number; sessions: number }[];
  bands: { date: string; skill: string; band: number; kind: "ESTIMATED" | "REVIEWED"; source: string }[];
  criteria: { skill: "WRITING" | "SPEAKING"; criterion: string; average: number; samples: number; kind: "ESTIMATED" | "REVIEWED" }[];
  production: {
    writing: { submissions: number; averageWords: number | null };
    speaking: { recordings: number; totalMinutes: number; averageWordsPerMinute: number | null };
    feedbackFocus: { results: number; grammarCorrections: number; vocabularySuggestions: number };
  };
  target: { targetBand: number | null; examDate: string | null; daysToExam: number | null; bySkill: { skill: string; band: number | null; kind: "ESTIMATED" | "REVIEWED" | null; gap: number | null }[]; overall: { band: number; kind: "ESTIMATED" | "REVIEWED" } | null };
};
type HistoryRow = { id: string; title: string; isMock: boolean; mode: string; status: string; date: string; rawScore: number | null; maxScore: number | null; accuracy: number | null; overallBand: number | null; sections: { skill: string; status: string; rawScore: number | null; maxScore: number | null; bandScore: number | null; minutes: number }[] };

/** What the three kinds of number mean. It stays on the page because mixing them up is the easy mistake to make. */
function ScoreGuide() {
  const t = useTranslations("analytics");
  return (
    <details className="bg-card rounded-xl border p-4 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium"><Info className="size-4" aria-hidden /> {t("guideTitle")}</summary>
      <dl className="mt-3 space-y-3">
        {(["RAW", "ESTIMATED", "REVIEWED"] as const).map((kind) => (
          <div key={kind}>
            <dt><KindBadge kind={kind} /></dt>
            <dd className="text-muted-foreground mt-1">{t(`guide.${kind}`)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function SkillCards({ skills }: { skills: Skill[] }) {
  const t = useTranslations("analytics");
  const labels = useLabels();
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {skills.map((row) => (
        <li key={row.skill}>
          <Card className="shadow-soft h-full">
            <CardContent>
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: SKILL_COLORS[row.skill] }} aria-hidden />
                <h3 className="font-display font-semibold">{labels.skill(row.skill)}</h3>
              </div>
              {row.accuracy !== null ? (
                <>
                  <p className="font-display mt-2 text-3xl font-semibold tabular-nums">{row.accuracy}%</p>
                  <p className="text-muted-foreground text-sm">{t("rawOf", { raw: row.rawScore ?? 0, max: row.maxScore ?? 0 })} <KindBadge kind="RAW" /></p>
                </>
              ) : (
                <p className="text-muted-foreground mt-2 text-sm">{row.sectionsCompleted > 0 ? t("notAutoMarked") : t("noPractice")}</p>
              )}
              <p className="text-muted-foreground mt-2 text-sm">{t("sectionsMinutes", { sections: row.sectionsCompleted, time: formatMinutes(row.minutes) })}</p>
              {row.lastPracticedAt && <p className="text-muted-foreground text-sm">{t("lastPracticed", { date: formatDate(row.lastPracticedAt) })}</p>}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function StrengthsWeaknesses({ rows }: { rows: Analytics["questionTypes"] }) {
  const t = useTranslations("analytics");
  const types = useTranslations("examAdmin.types");
  const labels = useLabels();
  const ready = rows.filter((row) => row.enoughData);
  if (ready.length === 0) return <Empty title={t("noTypes")} description={t("noTypesHint")} />;
  const toRow = (row: Analytics["questionTypes"][number]) => ({ key: `${row.skill}-${row.type}`, label: `${types.has(row.type) ? types(row.type) : row.type} (${labels.skill(row.skill)})`, value: row.accuracy, hint: t("correctOf", { correct: row.correct, total: row.total }), color: SKILL_COLORS[row.skill] });
  const weakest = ready.slice(0, 5);
  const strongest = [...ready].reverse().slice(0, 5).filter((row) => !weakest.includes(row));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="font-display mb-3 font-semibold">{t("needsWork")}</h3>
        <PercentBars label={t("needsWork")} rows={weakest.map(toRow)} />
      </div>
      <div>
        <h3 className="font-display mb-3 font-semibold">{t("strongest")}</h3>
        {strongest.length ? <PercentBars label={t("strongest")} rows={strongest.map(toRow)} /> : <p className="text-muted-foreground text-sm">{t("moreTypesNeeded")}</p>}
      </div>
    </div>
  );
}

function Production({ data }: { data: Analytics }) {
  const t = useTranslations("analytics");
  const criteria = useTranslations("ai.report.criteria");
  const labels = useLabels();
  const { writing, speaking, feedbackFocus } = data.production;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(["WRITING", "SPEAKING"] as const).map((skill) => {
        const rows = data.criteria.filter((row) => row.skill === skill);
        return (
          <Card key={skill} className="shadow-soft">
            <CardHeader><CardTitle className="font-display text-lg">{t("criteriaFor", { skill: labels.skill(skill) })}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {skill === "WRITING" ? (
                <p>{t("writingCounts", { count: writing.submissions, words: writing.averageWords ?? 0 })}</p>
              ) : (
                <p>{t("speakingCounts", { count: speaking.recordings, minutes: speaking.totalMinutes })}{speaking.averageWordsPerMinute !== null ? ` ${t("speakingPace", { wpm: speaking.averageWordsPerMinute })}` : ""}</p>
              )}
              {rows.length > 0 ? (
                <ul className="divide-y">
                  {rows.map((row) => (
                    <li key={`${row.criterion}-${row.kind}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{criteria.has(row.criterion) ? criteria(row.criterion) : row.criterion}</span>
                      <span className="flex items-center gap-2"><span className="font-medium tabular-nums">{row.average.toFixed(1)}</span> <KindBadge kind={row.kind} /> <span className="text-muted-foreground text-xs">{t("samples", { count: row.samples })}</span></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{skill === "WRITING" ? t("noWritingCriteria") : t("noSpeakingCriteria")}</p>
              )}
              {skill === "WRITING" && feedbackFocus.results > 0 && <p className="text-muted-foreground">{t("feedbackFocus", { results: feedbackFocus.results, grammar: feedbackFocus.grammarCorrections, vocabulary: feedbackFocus.vocabularySuggestions })}</p>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TargetProgress({ target }: { target: Analytics["target"] }) {
  const t = useTranslations("analytics");
  const labels = useLabels();
  const known = target.bySkill.filter((row) => row.band !== null);
  return (
    <Card className="shadow-soft">
      <CardHeader><CardTitle className="font-display flex items-center gap-2 text-lg"><Target className="size-5" aria-hidden /> {t("targetTitle")}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {target.targetBand === null ? (
          <p>{t("noTarget")} <Link href="/planner" className="text-primary underline underline-offset-2">{t("setGoals")}</Link></p>
        ) : (
          <p>{t("targetIs", { band: target.targetBand.toFixed(1) })}{target.daysToExam !== null && target.daysToExam >= 0 ? ` ${t("daysToExam", { days: target.daysToExam })}` : ""}</p>
        )}
        {known.length > 0 ? (
          <ul className="divide-y">
            {known.map((row) => (
              <li key={row.skill} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{labels.skill(row.skill)}</span>
                <span className="flex items-center gap-2"><span className="font-medium tabular-nums">{row.band?.toFixed(1)}</span>{row.kind && <KindBadge kind={row.kind} />}{row.gap !== null && <span className="text-muted-foreground text-xs">{row.gap > 0 ? t("toGo", { gap: row.gap.toFixed(1) }) : t("reached")}</span>}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{t("noBands")}</p>
        )}
        {target.overall ? (
          <p className="flex items-center gap-2">{t("overallBand")} <span className="font-medium tabular-nums">{target.overall.band.toFixed(1)}</span> <KindBadge kind={target.overall.kind} /></p>
        ) : known.length > 0 ? (
          <p className="text-muted-foreground">{t("noOverall")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TestHistory() {
  const t = useTranslations("analytics");
  const labels = useLabels();
  const [page, setPage] = useState(1);
  const history = useApiPage<HistoryRow>("/analytics/me/history", { page, pageSize: 10 });
  return (
    <QueryBoundary query={history}>
      {(data) =>
        data.items.length === 0 ? (
          <Empty title={t("noTests")} action={<Link href="/practice" className={buttonVariants()}>{t("startPractice")}</Link>} />
        ) : (
          <>
            <TableFrame label={t("testHistory")}>
              <thead><tr>{[t("date"), t("test"), t("score"), t("sections")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td className={tdClass}>{formatDate(row.date)}</td>
                    <td className={tdClass}>
                      <Link href={`/practice/attempts/${row.id}`} className="font-medium underline-offset-2 hover:underline">{row.title}</Link>
                      <span className="mt-1 flex flex-wrap gap-1">{row.isMock && <Badge variant="outline">{t("mock")}</Badge>}{row.status === "EXPIRED" && <Badge variant="outline">{t("timedOut")}</Badge>}</span>
                    </td>
                    <td className={tdClass}>
                      {row.maxScore ? <span className="tabular-nums">{t("rawOf", { raw: row.rawScore ?? 0, max: row.maxScore })}{row.accuracy !== null ? ` (${row.accuracy}%)` : ""}</span> : <span className="text-muted-foreground">{t("notAutoMarkedShort")}</span>}
                      {row.overallBand !== null && <span className="mt-1 flex items-center gap-2"><span className="tabular-nums">{row.overallBand.toFixed(1)}</span><KindBadge kind="ESTIMATED" /></span>}
                    </td>
                    <td className={tdClass}>
                      <ul className="space-y-0.5 text-xs">
                        {row.sections.map((section, index) => <li key={`${section.skill}-${index}`}>{labels.skill(section.skill)}: {section.maxScore ? `${section.rawScore ?? 0}/${section.maxScore}` : t("notAutoMarkedShort")}{section.bandScore !== null ? ` · ${section.bandScore.toFixed(1)}` : ""}</li>)}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <Pagination meta={data.meta} onPage={setPage} />
          </>
        )
      }
    </QueryBoundary>
  );
}

function Dashboard({ data }: { data: Analytics }) {
  const t = useTranslations("analytics");
  const labels = useLabels();
  const { overview } = data;
  const accuracyRows = useMemo(() => {
    const byWeek = new Map<string, Record<string, number>>();
    for (const row of data.weekly) byWeek.set(row.week, { ...(byWeek.get(row.week) ?? {}), [row.skill]: row.accuracy });
    return [...byWeek.entries()].map(([x, values]) => ({ x, values }));
  }, [data.weekly]);
  const accuracySeries = [...new Set(data.weekly.map((row) => row.skill))];
  const bandSeries = useMemo(() => [...new Set(data.bands.map((row) => row.skill))], [data.bands]);
  const bandRows = useMemo(() => data.bands.map((row) => ({ x: row.date.slice(0, 10), values: { [row.skill]: row.band } })), [data.bands]);
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: data.timeZone }).format(new Date()), [data.timeZone]);

  if (overview.attemptsStarted === 0 && data.activity.length === 0) {
    return <Empty title={t("nothingYet")} description={t("nothingYetHint")} icon={<BarChart3 aria-hidden />} action={<Link href="/practice" className={buttonVariants()}>{t("startPractice")}</Link>} />;
  }
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("accuracy")} value={overview.accuracy !== null ? `${overview.accuracy}%` : "-"} hint={overview.maxScore ? t("rawOf", { raw: overview.rawScore ?? 0, max: overview.maxScore }) : t("nothingMarked")} icon={<CheckCircle2 aria-hidden />} />
        <StatCard label={t("completion")} value={overview.completionRate !== null ? `${overview.completionRate}%` : "-"} hint={t("completionHint", { finished: overview.attemptsFinished, timedOut: overview.attemptsTimedOut, abandoned: overview.attemptsAbandoned })} icon={<BarChart3 aria-hidden />} />
        <StatCard label={t("studyTime")} value={formatMinutes(overview.minutes)} hint={t("activeDays", { count: overview.activeDays })} icon={<Clock aria-hidden />} />
        <StatCard label={t("streak")} value={t("streakDays", { count: overview.currentStreak })} hint={t("longest", { count: overview.longestStreak })} icon={<Flame aria-hidden />} />
      </div>

      <section aria-labelledby="skills-heading">
        <h2 id="skills-heading" className="font-display mb-3 text-xl font-semibold">{t("bySkill")}</h2>
        <SkillCards skills={data.skills} />
      </section>

      <section className="bg-card shadow-soft rounded-xl border p-4" aria-label={t("progressTitle")}>
        {accuracySeries.length > 0 ? (
          <TrendLines title={t("progressTitle")} series={accuracySeries} rows={accuracyRows} unit="%" labelFor={(key) => labels.skill(key)} yDomain={[0, 100]} />
        ) : (
          <Empty title={t("noTrend")} description={t("noTrendHint")} />
        )}
        <p className="text-muted-foreground mt-2 flex items-center gap-2 text-xs"><KindBadge kind="RAW" /> {t("progressNote")}</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <TargetProgress target={data.target} />
        <Card className="shadow-soft">
          <CardHeader><CardTitle className="font-display text-lg">{t("bandTrend")}</CardTitle></CardHeader>
          <CardContent>
            {bandRows.length > 0 ? (
              <TrendLines title={t("bandTrend")} series={bandSeries} rows={bandRows} unit="" labelFor={(key) => (key === "OVERALL" ? t("overall") : labels.skill(key))} yDomain={[0, 9]} />
            ) : (
              <p className="text-muted-foreground text-sm">{t("noBandTrend")}</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="bg-card shadow-soft rounded-xl border p-4" aria-labelledby="consistency-heading">
        <h2 id="consistency-heading" className="sr-only">{t("consistency")}</h2>
        <ActivityCalendar activity={data.activity} today={today} />
        <p className="text-muted-foreground mt-3 flex items-center gap-2 text-sm"><CalendarDays className="size-4" aria-hidden /> {t("consistencyNote", { active: overview.activeDays, days: data.days })}</p>
      </section>

      <section aria-labelledby="types-heading">
        <h2 id="types-heading" className="font-display mb-3 text-xl font-semibold">{t("strengthsTitle")}</h2>
        <div className="bg-card shadow-soft rounded-xl border p-4"><StrengthsWeaknesses rows={data.questionTypes} /></div>
      </section>

      <section aria-labelledby="production-heading">
        <h2 id="production-heading" className="font-display mb-3 text-xl font-semibold">{t("productionTitle")}</h2>
        <Production data={data} />
      </section>
    </div>
  );
}

export function AnalyticsPage() {
  const t = useTranslations("analytics");
  const [days, setDays] = useState("90");
  const query = useApiQuery<Analytics>(`/analytics/me?days=${days}`);
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} actions={<SelectBox hideLabel label={t("period")} className="w-40" value={days} onChange={(event) => setDays(event.target.value)} options={["30", "90", "180", "365"].map((value) => ({ value, label: t("lastDays", { days: value }) }))} />} />
      <div className="space-y-8">
        <ScoreGuide />
        <QueryBoundary query={query}>{(data) => <Dashboard data={data} />}</QueryBoundary>
        <section aria-labelledby="recs-heading">
          <h2 id="recs-heading" className="font-display mb-3 text-xl font-semibold">{t("recommendedTitle")}</h2>
          <Recommendations />
        </section>
        <ProgressReports />
        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="font-display mb-3 text-xl font-semibold">{t("testHistory")}</h2>
          <TestHistory />
        </section>
      </div>
    </>
  );
}
