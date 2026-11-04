"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BandScore } from "@/components/feedback/band-score";
import { ConfirmButton } from "@/features/platform/ui";
import { useFlag } from "@/features/release/release";
import { api, ApiRequestError } from "@/lib/api-client";
import { ConsentButton, useConsents, type ConsentType } from "./consent";

type Job = { id: string; status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"; errorMessage: string | null };
type Report = {
  bandVisibility: "HIDDEN" | "INTERNAL" | "PUBLIC";
  overallBand: number | null;
  summary: string;
  confidence: string | null;
  criteria: { criterion: string; feedback: string; evidence: { quote: string; comment: string }[]; band: number | null }[];
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  corrections: { original: string; corrected: string; explanation: string }[];
  vocabulary: { used: string; suggestion: string; reason: string }[];
  pronunciation: { note: string; measures: { accuracyScore?: number | null; fluencyScore?: number | null; prosodyScore?: number | null; pronunciationScore?: number | null } }[];
};
type Payload = { job: Job | null; result: Report | null; transcript?: string | null; fluency?: { wordsPerMinute?: number; pauseCount?: number; longPauseCount?: number; speakingSeconds?: number } | null };

const List = ({ title, items }: { title: string; items: string[] }) =>
  items.length ? (
    <div>
      <h4 className="font-sans text-sm font-semibold tracking-normal">{title}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  ) : null;

function ReportView({ report, speaking, transcript, fluency }: { report: Report; speaking: boolean; transcript?: string | null | undefined; fluency?: Payload["fluency"] }) {
  const t = useTranslations("ai.report");
  const measures = report.pronunciation[0]?.measures;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground flex items-start gap-1.5 text-xs"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {speaking ? t("speakingNote") : t("writingNote")}</p>
      {/* The band component's types make a score impossible while hidden, and the API has already removed it. */}
      {report.overallBand !== null && report.bandVisibility !== "HIDDEN" && <BandScore visibility={report.bandVisibility} band={report.overallBand} />}
      {report.summary && <p className="leading-relaxed">{report.summary}</p>}
      {report.confidence === "low" && <p className="text-warning flex items-start gap-1.5 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("lowConfidence")}</p>}
      <div className="space-y-3">
        {report.criteria.map((row) => (
          <section key={row.criterion} className="rounded-lg border p-3">
            <h4 className="font-sans text-sm font-semibold tracking-normal">{t(`criteria.${row.criterion}`)}{row.band !== null ? ` · ${row.band.toFixed(1)}` : ""}</h4>
            <p className="mt-1 text-sm leading-relaxed">{row.feedback}</p>
            {row.evidence.length > 0 && (
              <ul className="mt-2 space-y-2">
                {row.evidence.map((item) => (
                  <li key={item.quote} className="text-sm">
                    <blockquote className="border-primary/40 text-muted-foreground border-l-2 pl-3 italic">{item.quote}</blockquote>
                    <p className="mt-1 pl-3">{item.comment}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <List title={t("strengths")} items={report.strengths} />
        <List title={t("weaknesses")} items={report.weaknesses} />
      </div>
      {report.corrections.length > 0 && (
        <div>
          <h4 className="font-sans text-sm font-semibold tracking-normal">{t("corrections")}</h4>
          <ul className="mt-1 space-y-2 text-sm">
            {report.corrections.map((row) => (
              <li key={row.original} className="rounded-lg border p-3">
                <p className="break-words"><span className="text-muted-foreground">{t("original")}</span> {row.original}</p>
                <p className="break-words font-medium"><span className="text-muted-foreground font-normal">{t("better")}</span> {row.corrected}</p>
                <p className="text-muted-foreground mt-1">{row.explanation}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.vocabulary.length > 0 && (
        <div>
          <h4 className="font-sans text-sm font-semibold tracking-normal">{t("vocabulary")}</h4>
          <ul className="mt-1 space-y-1 text-sm">{report.vocabulary.map((row) => <li key={row.used} className="break-words"><span className="font-medium">{row.used}</span> → {row.suggestion}. <span className="text-muted-foreground">{row.reason}</span></li>)}</ul>
        </div>
      )}
      <List title={t("improvements")} items={report.improvements} />
      {fluency && <p className="text-muted-foreground text-sm">{t("delivery", { wpm: fluency.wordsPerMinute ?? 0, pauses: fluency.pauseCount ?? 0, long: fluency.longPauseCount ?? 0 })}</p>}
      {measures && (
        <section className="bg-muted rounded-lg p-3 text-sm">
          <h4 className="font-sans font-semibold tracking-normal">{t("pronunciationTitle")}</h4>
          <p className="text-muted-foreground mt-1">{t("pronunciationNote")}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(["accuracyScore", "fluencyScore", "prosodyScore"] as const).map((key) => (
              measures[key] != null && <div key={key}><dt className="text-muted-foreground">{t(`measures.${key}`)}</dt><dd className="font-medium tabular-nums">{t("outOf100", { value: Math.round(measures[key]!) })}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {transcript && (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{t("transcript")}</summary>
          <p className="mt-2 leading-relaxed whitespace-pre-wrap">{transcript}</p>
          <p className="text-muted-foreground mt-2 text-xs">{t("transcriptNote")}</p>
        </details>
      )}
    </div>
  );
}

/** Requests feedback, follows the background job, and shows the report. Used by Writing and Speaking. */
function Feedback({ path, types, speaking }: { path: string; types: ConsentType[]; speaking: boolean }) {
  const t = useTranslations("ai.report");
  const client = useQueryClient();
  const consents = useConsents();
  const [requestError, setRequestError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: [path],
    queryFn: () => api.get<Payload>(path),
    refetchInterval: (state) => (state.state.data?.job && ["PENDING", "PROCESSING"].includes(state.state.data.job.status) ? 4000 : false),
  });
  const job = query.data?.job;
  const running = job?.status === "PENDING" || job?.status === "PROCESSING";
  const available = speaking ? consents.data?.speechAvailable : consents.data?.aiAvailable;

  async function request() {
    setRequestError(null);
    try {
      await api.post(path);
      await client.invalidateQueries({ queryKey: [path] });
    } catch (error) {
      setRequestError(error instanceof ApiRequestError ? error.message : t("failed"));
    }
  }

  if (query.data?.result) return <ReportView report={query.data.result} speaking={speaking} transcript={query.data.transcript} fluency={query.data.fluency} />;
  return (
    <div className="bg-muted space-y-2 rounded-lg p-4 text-sm">
      {running ? (
        <p role="status" className="flex items-center gap-2 font-medium"><Loader2 className="size-4 animate-spin" aria-hidden /> {t("working")}</p>
      ) : (
        <>
          <p className="flex items-start gap-1.5"><Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden /> {speaking ? t("offerSpeaking") : t("offerWriting")}</p>
          {consents.data && !available ? (
            <p className="text-muted-foreground">{t("unavailable")}</p>
          ) : (
            <ConsentButton types={types} variant="outline" label={job?.status === "FAILED" ? t("tryAgain") : t("getFeedback")} onReady={() => void request()} />
          )}
        </>
      )}
      {job?.status === "FAILED" && <p role="alert" className="text-destructive">{job.errorMessage ?? t("failed")}</p>}
      {requestError && <p role="alert" className="text-destructive">{requestError}</p>}
    </div>
  );
}

type InstructorReview = { status: "REQUESTED" | "COMPLETED"; overallBand: number | null; criterionBands: Record<string, number>; note: string | null; completedAt: string | null } | null;

/** A person's assessment, kept apart from the AI's and clearly labelled as such. */
function InstructorReviewCard({ path }: { path: string }) {
  const t = useTranslations("ai.review");
  const criteria = useTranslations("ai.report.criteria");
  const enabled = useFlag("reviews.instructor");
  const client = useQueryClient();
  const query = useQuery({ queryKey: [path], queryFn: () => api.get<InstructorReview>(path) });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const review = query.data;

  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await client.invalidateQueries({ queryKey: [path] });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (query.isPending || (!review && !enabled)) return null;
  return (
    <section aria-label={t("title")} className="mt-4 rounded-lg border p-4 text-sm">
      <h4 className="font-sans font-semibold tracking-normal">{t("title")}</h4>
      {review?.status === "COMPLETED" ? (
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">{t("notOfficial")}</p>
          {review.overallBand !== null && <p>{t("overall")} <span className="font-semibold tabular-nums">{review.overallBand.toFixed(1)}</span></p>}
          {Object.keys(review.criterionBands).length > 0 && (
            <ul className="divide-y">
              {Object.entries(review.criterionBands).map(([key, band]) => <li key={key} className="flex justify-between gap-3 py-1.5"><span>{criteria.has(key) ? criteria(key) : key}</span><span className="font-medium tabular-nums">{band.toFixed(1)}</span></li>)}
            </ul>
          )}
          {review.note && <p className="leading-relaxed whitespace-pre-wrap">{review.note}</p>}
        </div>
      ) : review?.status === "REQUESTED" ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="flex-1 basis-48">{t("waiting")}</p>
          <button type="button" className="text-primary underline underline-offset-2" disabled={busy} onClick={() => void change(() => api.delete(path))}>{t("cancel")}</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground flex-1 basis-48">{t("offer")}</p>
          <button type="button" className="text-primary underline underline-offset-2" disabled={busy} onClick={() => void change(() => api.post(path))}>{t("ask")}</button>
        </div>
      )}
      {error && <p role="alert" className="text-destructive mt-2">{error}</p>}
    </section>
  );
}

export const WritingFeedback = ({ submissionId }: { submissionId: string }) => (
  <>
    <Feedback path={`/writing/submissions/${submissionId}/assessment`} types={["AI_PROCESSING"]} speaking={false} />
    <InstructorReviewCard path={`/writing/submissions/${submissionId}/review`} />
  </>
);
export const SpeakingFeedback = ({ submissionId }: { submissionId: string }) => (
  <>
    <Feedback path={`/speaking/submissions/${submissionId}/assessment`} types={["AI_PROCESSING", "SPEECH_PROCESSING"]} speaking />
    <InstructorReviewCard path={`/speaking/submissions/${submissionId}/review`} />
  </>
);

/** A student can delete their own voice data whenever they like. */
export function DeleteRecording({ submissionId, onDeleted }: { submissionId: string; onDeleted: () => void }) {
  const t = useTranslations("ai.report");
  const [done, setDone] = useState(false);
  if (done) return <p className="text-success mt-2 flex items-center gap-1.5 text-sm"><CheckCircle2 className="size-4" aria-hidden /> {t("recordingDeleted")}</p>;
  return (
    <div className="mt-2">
      <ConfirmButton
        label={<><Trash2 aria-hidden /> {t("deleteRecording")}</>}
        title={t("deleteRecordingTitle")}
        description={t("deleteRecordingBody")}
        destructive
        onConfirm={() => void api.delete(`/speaking/submissions/${submissionId}/audio`).then(() => { setDone(true); onDeleted(); })}
      />
    </div>
  );
}
