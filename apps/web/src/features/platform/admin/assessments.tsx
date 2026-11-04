"use client";

import { AlertTriangle, ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PrivateAudio } from "@/features/release/release";
import { api, ApiRequestError } from "@/lib/api-client";
import { formatDateTime } from "../format";
import { useApiAction, useApiPage, useApiQuery } from "../hooks";
import { useLabels } from "../labels";
import { Empty, InputField, PageHeader, Pagination, QueryBoundary, TableFrame, TextAreaField, tdClass, thClass } from "../ui";

type Row = { id: string; skill: string; task: string | null; requestedAt: string; completedAt: string | null; status: string };
type Detail = { id: string; status: string; skill: string; prompt: string; task: string | null; text: string | null; wordCount: number | null; minWords: number | null; transcript: string | null; hasRecording: boolean; criteria: string[]; overallBand: number | null; criterionBands: Record<string, number>; note: string | null };

/** The instructor sees the work and never the student's name, so the mark rests on the work alone. */
function ReviewForm({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useTranslations("assessmentReview");
  const criteriaLabel = useTranslations("ai.report.criteria");
  const labels = useLabels();
  const query = useApiQuery<Detail>(`/admin/reviews/${id}`);
  const [error, setError] = useState<string | null>(null);
  const save = useApiAction((body: object) => api.post(`/admin/reviews/${id}`, body), t("saved"));

  function submit(event: FormEvent<HTMLFormElement>, data: Detail) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const criterionBands: Record<string, number> = {};
    for (const key of data.criteria) {
      const value = String(form.get(key) ?? "");
      if (value) criterionBands[key] = Number(value);
    }
    const overall = String(form.get("overall") ?? "");
    save.mutate(
      { overallBand: overall ? Number(overall) : null, criterionBands, note: String(form.get("note") ?? "") || null },
      { onSuccess: onBack, onError: (caught) => setError(caught instanceof ApiRequestError ? caught.message : t("failed")) },
    );
  }

  const band = { type: "number", min: 0, max: 9, step: 0.5 } as const;
  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}><ArrowLeft aria-hidden /> {t("back")}</Button>
      <QueryBoundary query={query}>
        {(data) => (
          <form className="bg-card shadow-soft space-y-4 rounded-xl border p-4" onSubmit={(event) => submit(event, data)}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{labels.skill(data.skill)}</Badge>
              {data.task && <Badge variant="outline">{data.task}</Badge>}
              {data.wordCount !== null && <span className="text-muted-foreground text-sm">{t("words", { count: data.wordCount, min: data.minWords ?? 0 })}</span>}
            </div>
            <p className="text-muted-foreground text-sm whitespace-pre-wrap">{data.prompt}</p>
            {data.text !== null && <p className="bg-muted max-h-96 overflow-y-auto rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap">{data.text}</p>}
            {data.skill === "SPEAKING" && (
              <div className="space-y-2">
                {data.hasRecording ? <PrivateAudio path={`/admin/reviews/${id}/audio`} label={t("listen")} /> : <p className="flex items-start gap-2 text-sm"><AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden /> {t("noRecording")}</p>}
                {data.transcript && <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">{t("transcript")}</summary><p className="mt-2 whitespace-pre-wrap">{data.transcript}</p><p className="text-muted-foreground mt-2 text-xs">{t("transcriptNote")}</p></details>}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {data.criteria.map((key) => <InputField key={key} name={key} label={criteriaLabel(key)} defaultValue={data.criterionBands[key] ?? ""} disabled={key === "PRONUNCIATION" && !data.hasRecording} {...band} />)}
              <InputField name="overall" label={t("overall")} defaultValue={data.overallBand ?? ""} {...band} />
            </div>
            <p className="text-muted-foreground text-sm">{t("overallHint")}</p>
            <TextAreaField name="note" label={t("note")} rows={4} defaultValue={data.note ?? ""} />
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={save.isPending}>{t("saveReview")}</Button>
          </form>
        )}
      </QueryBoundary>
    </div>
  );
}

function Queue({ status, onOpen }: { status: "REQUESTED" | "COMPLETED"; onOpen: (id: string) => void }) {
  const t = useTranslations("assessmentReview");
  const labels = useLabels();
  const [page, setPage] = useState(1);
  const query = useApiPage<Row>("/admin/reviews", { page, pageSize: 20, status });
  return (
    <QueryBoundary query={query}>
      {(data) =>
        data.items.length === 0 ? <Empty title={status === "REQUESTED" ? t("nothingWaiting") : t("nothingDone")} /> : (
          <>
            <TableFrame label={t("title")}>
              <thead><tr>{[t("skill"), t("task"), t("requested"), ""].map((heading, index) => <th key={`${heading}-${index}`} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
              <tbody>{data.items.map((row) => <tr key={row.id}><td className={tdClass}>{labels.skill(row.skill)}</td><td className={tdClass}>{row.task ?? "-"}</td><td className={tdClass}>{formatDateTime(row.requestedAt)}</td><td className={tdClass}><Button variant="outline" size="sm" onClick={() => onOpen(row.id)}>{status === "REQUESTED" ? t("review") : t("open")}</Button></td></tr>)}</tbody>
            </TableFrame>
            <Pagination meta={data.meta} onPage={setPage} />
          </>
        )
      }
    </QueryBoundary>
  );
}

export function AssessmentReviewPage() {
  const t = useTranslations("assessmentReview");
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      {open ? (
        <ReviewForm id={open} onBack={() => setOpen(null)} />
      ) : (
        <Tabs defaultValue="waiting">
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="waiting">{t("waiting")}</TabsTrigger>
            <TabsTrigger value="done">{t("done")}</TabsTrigger>
          </TabsList>
          <TabsContent value="waiting" className="mt-4"><Queue status="REQUESTED" onOpen={setOpen} /></TabsContent>
          <TabsContent value="done" className="mt-4"><Queue status="COMPLETED" onOpen={setOpen} /></TabsContent>
        </Tabs>
      )}
    </>
  );
}
