"use client";

import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ClipboardList, Clock, Headphones, History, Info, Lock, Mic, MonitorPlay, PenLine, Play, Target, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime } from "@/features/platform/format";
import { useApiAction, useApiPage, useApiQuery, useDebounced } from "@/features/platform/hooks";
import { useLabels } from "@/features/platform/labels";
import { ConfirmButton, Empty, PageHeader, Pagination, QueryBoundary, SearchField, SelectBox } from "@/features/platform/ui";
import { api, ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { WRITING_CRITERIA } from "./player";
import { durationLabel, type AttemptResult, type AttemptRow, type ExamDetail, type ExamListItem, type ResultSection, type ReviewItem, type SpeakingRow, type WritingRow } from "./types";

const SKILL_ICONS: Record<string, typeof BookOpen> = { LISTENING: Headphones, READING: BookOpen, WRITING: PenLine, SPEAKING: Mic };
const PREVIEWS = [
  { skill: "listening", value: "LISTENING", icon: Headphones },
  { skill: "reading", value: "READING", icon: BookOpen },
  { skill: "writing", value: "WRITING", icon: PenLine },
  { skill: "speaking", value: "SPEAKING", icon: Mic },
];

function GridSkeleton() {
  const t = useTranslations("practice");
  return <div role="status" aria-label={t("loading")} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="h-44 rounded-xl" />)}</div>;
}

export function PracticeHome() {
  const t = useTranslations("practice");
  const app = useTranslations("app");
  const labels = useLabels();
  const [search, setSearch] = useState("");
  const [examType, setExamType] = useState("");
  const [skill, setSkill] = useState("");
  const [isMock, setIsMock] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const query = useApiPage<ExamListItem>("/exams", { page, pageSize: 12, search: debounced, examType, skill, isMock });
  const reset = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };
  return (
    <>
      <PageHeader title={app("ielts_practice")} description={t("homeIntro")} actions={<Button asChild variant="outline"><Link href="/practice/history"><History aria-hidden /> {t("historyTitle")}</Link></Button>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchField label={t("searchExams")} value={search} onChange={reset(setSearch)} />
        <SelectBox hideLabel label={app("ielts_type")} value={examType} onChange={(e) => reset(setExamType)(e.target.value)} options={[{ value: "", label: app("all_ielts_types") }, { value: "ACADEMIC", label: labels.examType("ACADEMIC") }, { value: "GENERAL_TRAINING", label: labels.examType("GENERAL_TRAINING") }]} />
        <SelectBox hideLabel label={app("skill")} value={skill} onChange={(e) => reset(setSkill)(e.target.value)} options={[{ value: "", label: app("all_skills") }, ...["LISTENING", "READING", "WRITING", "SPEAKING"].map((value) => ({ value, label: labels.skill(value) }))]} />
        <SelectBox hideLabel label={t("examKind")} value={isMock} onChange={(e) => reset(setIsMock)(e.target.value)} options={[{ value: "", label: t("allKinds") }, { value: "false", label: t("skillPractice") }, { value: "true", label: t("mockTests") }]} />
      </div>
      <QueryBoundary query={query} loading={<GridSkeleton />}>
        {({ items, meta }) =>
          items.length === 0 ? (
            <Empty icon={<Target aria-hidden />} title={t("noExams")} description={t("noExamsBody")} />
          ) : (
            <>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((exam) => (
                  <li key={exam.id}>
                    <Card className="lift shadow-soft relative h-full">
                      <CardContent className="flex h-full flex-col gap-3">
                        <div className="flex flex-wrap gap-1.5">
                          {exam.isMock && <Badge>{t("mockTest")}</Badge>}
                          <Badge variant="secondary">{exam.examType ? labels.examType(exam.examType) : app("both_ielts_types")}</Badge>
                          {exam.isPremium && <Badge variant="outline"><Lock aria-hidden /> {app("premium")}</Badge>}
                        </div>
                        <h2 className="font-display text-lg font-semibold break-words">
                          <Link href={`/practice/exams/${exam.id}`} className="underline-offset-4 after:absolute after:inset-0 hover:underline">{exam.title}</Link>
                        </h2>
                        <p className="text-muted-foreground mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="inline-flex items-center gap-1"><Clock className="size-4" aria-hidden /> {durationLabel(exam.durationSeconds)}</span>
                          {exam.questionCount > 0 && <span>{t("questionCount", { count: exam.questionCount })}</span>}
                        </p>
                        <ul aria-label={t("skillsCovered")} className="flex gap-1.5">
                          {exam.skills.map((value) => {
                            const Icon = SKILL_ICONS[value] ?? BookOpen;
                            return <li key={value} title={labels.skill(value)} className="bg-accent text-accent-foreground rounded-md p-1.5"><Icon className="size-4" aria-hidden /><span className="sr-only">{labels.skill(value)}</span></li>;
                          })}
                        </ul>
                        {exam.activeAttemptId && <p className="text-primary text-sm font-medium">{t("inProgress")}</p>}
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
      <section aria-labelledby="exam-previews" className="bg-card shadow-soft mt-8 rounded-2xl border p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <MonitorPlay className="text-primary mt-1 size-5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <h2 id="exam-previews" className="font-display text-lg font-semibold">{app("preview_the_exam_screens")}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{app("exam_preview_note")}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {PREVIEWS.map(({ skill: name, value, icon: Icon }) => (
            <Link key={name} href={`/practice/preview/${name}`} className="lift bg-background flex min-h-20 flex-col justify-between gap-3 rounded-xl border p-4 text-sm font-medium">
              <Icon className="text-primary size-5" aria-hidden />
              <span>{app("skill_preview", { skill: labels.skill(value) })}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

export function ExamDetailPage() {
  const t = useTranslations("practice");
  const labels = useLabels();
  const { examId } = useParams<{ examId: string }>();
  const router = useRouter();
  const query = useApiQuery<ExamDetail>(`/exams/${examId}`);
  const [starting, setStarting] = useState(false);

  async function start(mode?: "TIMED" | "PRACTICE") {
    setStarting(true);
    try {
      const attempt = await api.post<{ id: string }>(`/exams/${examId}/attempts`, mode ? { mode } : {});
      router.push(`/exam/${attempt.id}`);
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : t("somethingWrong"));
      setStarting(false);
    }
  }

  return (
    <QueryBoundary query={query}>
      {(exam) => (
        <>
          <Button asChild variant="ghost" size="sm" className="mb-3"><Link href="/practice"><ArrowLeft aria-hidden /> {t("backToPractice")}</Link></Button>
          <PageHeader title={exam.title} description={exam.navigation === "SEQUENTIAL" ? t("modes.sequentialNote") : t("modes.freeNote")} />
          <div className="grid gap-6 lg:grid-cols-3">
            <ol className="bg-card shadow-soft divide-y rounded-xl border lg:col-span-2">
              {exam.sections.map((section) => {
                const Icon = SKILL_ICONS[section.skill] ?? BookOpen;
                return (
                  <li key={section.id} className="flex gap-3 p-4">
                    <span className="bg-accent text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"><Icon className="size-4" aria-hidden /></span>
                    <div className="min-w-0">
                      <h2 className="font-sans font-medium tracking-normal break-words">{section.title}</h2>
                      <p className="text-muted-foreground text-sm">{labels.skill(section.skill)} · {durationLabel(section.durationSeconds)}{section.questionCount ? ` · ${t("questionCount", { count: section.questionCount })}` : ""}</p>
                      {section.instructions && <p className="text-muted-foreground mt-1 text-sm whitespace-pre-wrap">{section.instructions}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
            <Card className="shadow-soft h-fit">
              <CardHeader><CardTitle className="font-display text-lg">{t("startTitle")}</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                {exam.activeAttemptId ? (
                  <Button asChild size="lg"><Link href={`/exam/${exam.activeAttemptId}`}><Play aria-hidden /> {t("resumeAttempt")}</Link></Button>
                ) : exam.isMock ? (
                  <Button size="lg" disabled={starting} onClick={() => void start()}><Play aria-hidden /> {t("startMock")}</Button>
                ) : (
                  <>
                    <Button size="lg" disabled={starting} onClick={() => void start("TIMED")}><Clock aria-hidden /> {t("startTimed")}</Button>
                    <Button size="lg" variant="outline" disabled={starting} onClick={() => void start("PRACTICE")}><Target aria-hidden /> {t("startPractice")}</Button>
                  </>
                )}
                <p className="text-muted-foreground mt-1 text-sm">{t("startNote")}</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </QueryBoundary>
  );
}

const responseText = (item: ReviewItem, none: string) => {
  const response = item.response;
  if (!response) return none;
  if ("text" in response) return response.text.trim() || none;
  return response.selected.length ? response.selected.join(", ") : none;
};

function ReviewList({ items }: { items: ReviewItem[] }) {
  const t = useTranslations("practice.result");
  return (
    <ol className="divide-y">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 py-3 text-sm">
          {item.isCorrect ? <CheckCircle2 className="text-success mt-0.5 size-5 shrink-0" aria-hidden /> : <XCircle className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="font-medium break-words"><span className="tabular-nums">{item.number}.</span> {item.prompt}</p>
            <p className="sr-only">{item.isCorrect ? t("correct") : t("incorrect")}</p>
            <p className="mt-1 break-words"><span className="text-muted-foreground">{t("yourAnswer")}</span> {responseText(item, t("noAnswer"))}</p>
            <p className="break-words"><span className="text-muted-foreground">{t("acceptedAnswer")}</span> {item.acceptedAnswers.join(" / ")}</p>
            {item.explanation && <p className="text-muted-foreground mt-1 break-words whitespace-pre-wrap">{item.explanation}</p>}
            {item.marks > 1 && <p className="text-muted-foreground mt-1 tabular-nums">{t("marks", { awarded: item.marksAwarded, marks: item.marks })}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function RecordingPlayback({ path }: { path: string }) {
  const t = useTranslations("practice.result");
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  if (source) return <audio controls src={source} aria-label={t("yourRecording")} className="mt-2 w-full max-w-md" />;
  return (
    <>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => { setFailed(false); api.getBlob(path).then((blob) => setSource(URL.createObjectURL(blob)), () => setFailed(true)); }}><Play aria-hidden /> {t("playRecording")}</Button>
      {failed && <p role="alert" className="text-destructive mt-1 text-sm">{t("recordingFailed")}</p>}
    </>
  );
}

function SectionResult({ attemptId, section, reviewAllowed }: { attemptId: string; section: ResultSection; reviewAllowed: boolean }) {
  const t = useTranslations("practice");
  const r = useTranslations("practice.result");
  const w = useTranslations("practice.writing");
  const labels = useLabels();
  const scored = section.maxScore !== null;
  return (
    <Card className="shadow-soft">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="font-display text-lg break-words">{section.title}</CardTitle>
          <p className="text-muted-foreground text-sm">{labels.skill(section.skill)} · {t(`status.${section.status}`)}</p>
        </div>
        {scored && <p className="font-display text-2xl font-semibold tabular-nums">{r("score", { raw: section.rawScore ?? 0, max: section.maxScore ?? 0 })}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        {section.review && <ReviewList items={section.review} />}
        {scored && !section.review && !reviewAllowed && <p className="text-muted-foreground text-sm">{r("reviewOff")}</p>}
        {section.transcripts?.map((transcript, index) => (
          <details key={index} className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer font-medium">{r("transcript", { number: index + 1 })}</summary>
            <p className="mt-2 leading-relaxed whitespace-pre-wrap">{transcript}</p>
          </details>
        ))}
        {section.writing && (
          <>
            {section.writing.length === 0 && <p className="text-muted-foreground text-sm">{r("nothingWritten")}</p>}
            {section.writing.map((item) => (
              <article key={item.id} className="rounded-lg border p-4">
                <h3 className="font-sans text-sm font-semibold tracking-normal whitespace-pre-wrap">{item.writingTask.prompt}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{w("wordCount", { words: item.wordCount, minimum: item.writingTask.minWords })}{item.submittedAt ? ` · ${r("submittedOn", { date: formatDateTime(item.submittedAt) })}` : ""}</p>
                <p className="mt-3 leading-relaxed break-words whitespace-pre-wrap">{item.text}</p>
              </article>
            ))}
            <div className="bg-muted rounded-lg p-4 text-sm">
              <p className="font-medium">{w("criteriaTitle")}</p>
              <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">{WRITING_CRITERIA.map((key) => <li key={key}>{w(`criteria.${key}`)}</li>)}</ul>
              <p className="mt-3 flex items-start gap-1.5"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {w("assessmentLater")}</p>
            </div>
          </>
        )}
        {section.speaking && (
          <>
            {section.speaking.length === 0 && <p className="text-muted-foreground text-sm">{r("nothingRecorded")}</p>}
            <ul className="space-y-3">
              {section.speaking.map((item) => (
                <li key={item.id} className="rounded-lg border p-4 text-sm">
                  <p className="font-medium">{item.speakingQuestion.prompt}</p>
                  {item.hasRecording && <RecordingPlayback path={`/attempts/${attemptId}/sections/${section.id}/speaking/${item.speakingQuestion.id}/recording`} />}
                </li>
              ))}
            </ul>
            <p className="bg-muted flex items-start gap-1.5 rounded-lg p-4 text-sm"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("speaking.assessmentLater")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AttemptResultPage() {
  const t = useTranslations("practice");
  const r = useTranslations("practice.result");
  const { attemptId } = useParams<{ attemptId: string }>();
  const query = useApiQuery<AttemptResult>(`/attempts/${attemptId}/result`);
  return (
    <QueryBoundary query={query}>
      {(result) => (
        <>
          <Button asChild variant="ghost" size="sm" className="mb-3"><Link href="/practice/history"><ArrowLeft aria-hidden /> {t("historyTitle")}</Link></Button>
          <header className="bg-brand-surface relative mb-6 overflow-hidden rounded-2xl p-6 sm:p-8">
            <div aria-hidden className="brand-grid absolute inset-0" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-semibold tracking-tight break-words sm:text-3xl">{result.attempt.exam.title}</h1>
                <p className="text-on-brand-muted mt-1">{t(`status.${result.attempt.status}`)}{result.attempt.submittedAt ? ` · ${formatDateTime(result.attempt.submittedAt)}` : ""}</p>
              </div>
              {result.maxScore !== null && (
                <div className="shrink-0 sm:text-right">
                  <p className="font-display text-4xl font-semibold tabular-nums">{r("score", { raw: result.rawScore ?? 0, max: result.maxScore })}</p>
                  <p className="text-on-brand-muted text-sm">{r("rawLabel")}</p>
                </div>
              )}
            </div>
          </header>
          {result.maxScore !== null && <p className="text-muted-foreground mb-4 flex items-start gap-1.5 text-sm"><Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {r("rawNote")}</p>}
          <div className="space-y-4">{result.sections.map((section) => <SectionResult key={section.id} attemptId={attemptId} section={section} reviewAllowed={result.reviewAllowed} />)}</div>
        </>
      )}
    </QueryBoundary>
  );
}

function AttemptHistory() {
  const t = useTranslations("practice");
  const labels = useLabels();
  const [page, setPage] = useState(1);
  const query = useApiPage<AttemptRow>("/attempts", { page, pageSize: 15 });
  return (
    <QueryBoundary query={query}>
      {({ items, meta }) =>
        items.length === 0 ? <Empty icon={<ClipboardList aria-hidden />} title={t("noAttempts")} description={t("noAttemptsBody")} action={<Button asChild><Link href="/practice">{t("browseExams")}</Link></Button>} /> : (
          <>
            <ul className="bg-card shadow-soft divide-y rounded-xl border">
              {items.map((row) => (
                <li key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{row.exam.title}</p>
                    <p className="text-muted-foreground text-sm">{t(`modeNames.${row.mode}`)} · {t(`status.${row.status}`)} · {formatDateTime(row.startedAt)}{row.exam.examType ? ` · ${labels.examType(row.exam.examType)}` : ""}</p>
                  </div>
                  {row.maxScore !== null && <p className="font-display font-semibold tabular-nums">{t("result.score", { raw: row.rawScore ?? 0, max: row.maxScore })}</p>}
                  {row.status === "IN_PROGRESS" ? (
                    <Button asChild size="sm"><Link href={`/exam/${row.id}`}>{t("resumeAttempt")} <ArrowRight aria-hidden /></Link></Button>
                  ) : row.status !== "ABANDONED" ? (
                    <Button asChild size="sm" variant="outline"><Link href={`/practice/attempts/${row.id}`}>{t("viewResult")}</Link></Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <Pagination meta={meta} onPage={setPage} />
          </>
        )
      }
    </QueryBoundary>
  );
}

function WritingHistory() {
  const t = useTranslations("practice");
  const [page, setPage] = useState(1);
  const query = useApiPage<WritingRow>("/writing/submissions", { page, pageSize: 15 });
  const discard = useApiAction((id: string) => api.delete(`/writing/submissions/${id}`), t("draftDiscarded"));
  return (
    <QueryBoundary query={query}>
      {({ items, meta }) =>
        items.length === 0 ? <Empty icon={<PenLine aria-hidden />} title={t("noWriting")} /> : (
          <>
            <ul className="bg-card shadow-soft divide-y rounded-xl border">
              {items.map((row) => (
                <li key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-medium break-words">{row.examTitle}</p><Badge variant={row.submittedAt ? "secondary" : "outline"}>{row.submittedAt ? t("submitted") : t("draft")}</Badge></div>
                    <p className="text-muted-foreground line-clamp-2 text-sm">{row.writingTask.prompt}</p>
                    <p className="text-muted-foreground mt-1 text-xs">{t("writing.wordCount", { words: row.wordCount, minimum: row.writingTask.minWords })} · {formatDateTime(row.submittedAt ?? row.lastSavedAt)}</p>
                  </div>
                  {row.submittedAt ? (
                    <Button asChild size="sm" variant="outline"><Link href={`/practice/attempts/${row.attemptId}`}>{t("viewResult")}</Link></Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button asChild size="sm"><Link href={`/exam/${row.attemptId}`}>{t("continueDraft")}</Link></Button>
                      <ConfirmButton label={t("discardDraft")} title={t("discardDraftTitle")} description={t("discardDraftBody")} destructive onConfirm={() => discard.mutate(row.id)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Pagination meta={meta} onPage={setPage} />
          </>
        )
      }
    </QueryBoundary>
  );
}

function SpeakingHistory() {
  const t = useTranslations("practice");
  const [page, setPage] = useState(1);
  const query = useApiPage<SpeakingRow>("/speaking/submissions", { page, pageSize: 15 });
  return (
    <QueryBoundary query={query}>
      {({ items, meta }) =>
        items.length === 0 ? <Empty icon={<Mic aria-hidden />} title={t("noSpeaking")} /> : (
          <>
            <ul className="bg-card shadow-soft divide-y rounded-xl border">
              {items.map((row) => (
                <li key={row.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2"><p className="font-medium break-words">{row.examTitle}</p><Badge variant={row.submittedAt ? "secondary" : "outline"}>{row.submittedAt ? t("submitted") : t("recordedNotSubmitted")}</Badge></div>
                  <p className="text-muted-foreground text-sm">{t(`speaking.parts.${row.speakingQuestion.part}`)}: {row.speakingQuestion.prompt}</p>
                  <p className="text-muted-foreground mt-1 text-xs">{formatDateTime(row.submittedAt ?? row.createdAt)}</p>
                  <RecordingPlayback path={`/attempts/${row.attemptId}/sections/${row.sectionId}/speaking/${row.speakingQuestionId}/recording`} />
                </li>
              ))}
            </ul>
            <Pagination meta={meta} onPage={setPage} />
          </>
        )
      }
    </QueryBoundary>
  );
}

export function PracticeHistoryPage() {
  const t = useTranslations("practice");
  return (
    <>
      <PageHeader title={t("historyTitle")} description={t("historyIntro")} />
      <Tabs defaultValue="attempts">
        <TabsList className={cn("w-full sm:w-fit")}>
          <TabsTrigger value="attempts">{t("attemptsTab")}</TabsTrigger>
          <TabsTrigger value="writing">{t("writingTab")}</TabsTrigger>
          <TabsTrigger value="speaking">{t("speakingTab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="attempts" className="mt-4"><AttemptHistory /></TabsContent>
        <TabsContent value="writing" className="mt-4"><WritingHistory /></TabsContent>
        <TabsContent value="speaking" className="mt-4"><SpeakingHistory /></TabsContent>
      </Tabs>
    </>
  );
}
