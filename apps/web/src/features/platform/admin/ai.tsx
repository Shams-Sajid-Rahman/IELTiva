"use client";

import { AlertTriangle, Bot, CheckCircle2, Coins, Hash, Plus, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { StatCard } from "@/components/feedback/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/features/auth/auth-provider";
import { api, ApiRequestError } from "@/lib/api-client";
import { useApiAction, useApiPage, useApiQuery } from "../hooks";
import { useLabels } from "../labels";
import { ConfirmButton, Empty, FormDialog, InputField, PageHeader, Pagination, QueryBoundary, SelectBox, TableFrame, TextAreaField, tdClass, thClass } from "../ui";

type Usage = { configured: boolean; requests: number; failures: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; spentTodayUsd: number; byTask: { taskKey: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number }[]; byModel: { modelId: string; requests: number; costUsd: number }[] };
type Models = { tasks: { taskKey: string; tier: string; defaultModel: string }[]; configurations: { taskKey: string; modelId: string; isActive: boolean }[] };

const usd = (value: number) => `$${value.toFixed(value < 1 ? 4 : 2)}`;

export function AiUsagePage() {
  const t = useTranslations("ai.usage");
  const { hasPermission } = useAuth();
  const usage = useApiQuery<Usage>("/admin/ai/usage");
  const models = useApiQuery<Models>("/admin/ai/models");
  const setModel = useApiAction((body: { taskKey: string; modelId: string }) => api.put("/admin/ai/models", body), t("modelSaved"));
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <QueryBoundary query={usage}>
        {(data) => (
          <div className="space-y-6">
            {!data.configured && <p className="bg-card flex items-start gap-2 rounded-xl border p-4 text-sm"><AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden /> {t("notConfigured")}</p>}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={t("cost")} value={usd(data.costUsd)} hint={t("last30")} icon={<Coins aria-hidden />} />
              <StatCard label={t("today")} value={usd(data.spentTodayUsd)} icon={<Coins aria-hidden />} />
              <StatCard label={t("requests")} value={data.requests} hint={t("failures", { count: data.failures })} icon={<Bot aria-hidden />} />
              <StatCard label={t("tokens")} value={(data.inputTokens + data.outputTokens).toLocaleString("en")} hint={t("cached", { count: data.cacheReadTokens.toLocaleString("en") })} icon={<Hash aria-hidden />} />
            </div>
            {data.byTask.length === 0 ? <Empty title={t("noUsage")} /> : (
              <TableFrame label={t("byTask")}>
                <thead><tr>{[t("task"), t("requests"), t("input"), t("output"), t("cost")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
                <tbody>{data.byTask.map((row) => <tr key={row.taskKey}><td className={tdClass}>{row.taskKey}</td><td className={tdClass}>{row.requests}</td><td className={tdClass}>{row.inputTokens.toLocaleString("en")}</td><td className={tdClass}>{row.outputTokens.toLocaleString("en")}</td><td className={tdClass}>{usd(row.costUsd)}</td></tr>)}</tbody>
              </TableFrame>
            )}
          </div>
        )}
      </QueryBoundary>
      <section aria-labelledby="models-heading" className="mt-8">
        <h2 id="models-heading" className="font-display mb-1 text-xl font-semibold">{t("modelsTitle")}</h2>
        <p className="text-muted-foreground mb-4 text-sm">{t("modelsIntro")}</p>
        <QueryBoundary query={models}>
          {(data) => (
            <ul className="bg-card shadow-soft divide-y rounded-xl border">
              {data.tasks.map((task) => {
                const active = data.configurations.find((row) => row.taskKey === task.taskKey && row.isActive)?.modelId;
                return (
                  <li key={task.taskKey} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{task.taskKey} <Badge variant="outline">{task.tier}</Badge></p>
                      <p className="text-muted-foreground text-sm break-all">{active ?? task.defaultModel}{active ? "" : ` ${t("defaultModel")}`}</p>
                    </div>
                    {hasPermission("ai.configure") && (
                      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const modelId = String(new FormData(event.currentTarget).get("modelId") ?? "").trim(); if (modelId) setModel.mutate({ taskKey: task.taskKey, modelId }); }}>
                        <InputField name="modelId" label={t("modelFor", { task: task.taskKey })} placeholder={t("modelId")} className="w-56" />
                        <Button type="submit" variant="outline" className="self-end" disabled={setModel.isPending}>{t("change")}</Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </QueryBoundary>
      </section>
    </>
  );
}

type Dataset = { id: string; version: string; skill: string; examType: string | null; taskType: string | null; targetSamples: number; targetMae: string; targetWithinOne: string; markTolerance: string; frozenAt: string | null; thresholdsApprovedAt: string | null; _count?: { samples: number; runs: number } };
type Metrics = { count: number; mae: number | null; exact: number; withinHalf: number; withinOne: number; meetsTargets: boolean; samplesInSplit?: number; targets: { samples: number; mae: number; withinOne: number } };
type Run = { id: string; split: string; taskKey: string; status: string; metrics: Metrics | null; errorMessage: string | null; instructorApprovedAt: string | null; createdAt: string; modelConfiguration: { modelId: string } | null; promptVersion: { taskKey: string; version: number } | null };
type DatasetFull = Dataset & { statusCounts: Record<string, number>; runs: Run[] };
type MarkSample = { id: string; reference: string; prompt: string; responseText: string; records?: { overallBand: string; criterionBands: Record<string, number>; notes: string | null }[] };

const WRITING_CRITERIA = (taskType: string | null) => [taskType === "TASK_2" ? "TASK_RESPONSE" : "TASK_ACHIEVEMENT", "COHERENCE_COHESION", "LEXICAL_RESOURCE", "GRAMMATICAL_RANGE_ACCURACY"];
const SPEAKING_CRITERIA = ["FLUENCY_COHERENCE", "LEXICAL_RESOURCE", "GRAMMATICAL_RANGE_ACCURACY", "PRONUNCIATION"];

/** The form markers and adjudicators fill in. It shows only the writing, so each mark stays independent. */
function MarkForm({ sample, criteria, action, onDone }: { sample: MarkSample; criteria: string[]; action: string; onDone: () => void }) {
  const t = useTranslations("ai.calibration");
  const report = useTranslations("ai.report.criteria");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.post(action, {
        overallBand: Number(data.get("overall")),
        criterionBands: Object.fromEntries(criteria.map((key) => [key, Number(data.get(key))])),
        notes: String(data.get("notes") ?? "") || null,
      });
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }
  const band = { type: "number", min: 0, max: 9, step: 0.5, required: true } as const;
  return (
    <form className="space-y-3 rounded-xl border p-4" onSubmit={(event) => void submit(event)}>
      <p className="text-sm font-semibold">{sample.reference}</p>
      <p className="text-muted-foreground text-sm whitespace-pre-wrap">{sample.prompt}</p>
      <p className="bg-muted max-h-72 overflow-y-auto rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap">{sample.responseText}</p>
      {sample.records && <p className="text-muted-foreground text-sm">{t("existingMarks", { marks: sample.records.map((row) => Number(row.overallBand).toFixed(1)).join(", ") })}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {criteria.map((key) => <InputField key={key} name={key} label={report(key)} {...band} />)}
        <InputField name="overall" label={t("overall")} {...band} />
      </div>
      <TextAreaField name="notes" label={t("notes")} rows={2} />
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={busy}>{t("saveMark")}</Button>
    </form>
  );
}

function SampleQueue({ datasetId, kind, criteria }: { datasetId: string; kind: "marking" | "adjudication"; criteria: string[] }) {
  const t = useTranslations("ai.calibration");
  const [page, setPage] = useState(1);
  const query = useApiPage<MarkSample>(`/admin/calibration/datasets/${datasetId}/${kind}`, { page, pageSize: 5 });
  return (
    <QueryBoundary query={query}>
      {({ items, meta }) =>
        items.length === 0 ? <p className="text-muted-foreground text-sm">{kind === "marking" ? t("nothingToMark") : t("nothingToAdjudicate")}</p> : (
          <div className="space-y-3">
            {items.map((sample) => <MarkForm key={sample.id} sample={sample} criteria={criteria} action={`/admin/calibration/samples/${sample.id}/${kind === "marking" ? "marks" : "adjudication"}`} onDone={() => void query.refetch()} />)}
            <Pagination meta={meta} onPage={setPage} />
          </div>
        )
      }
    </QueryBoundary>
  );
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function RunCard({ run, canRelease, canApprove }: { run: Run; canRelease: boolean; canApprove: boolean }) {
  const t = useTranslations("ai.calibration");
  const approve = useApiAction(() => api.post(`/admin/calibration/runs/${run.id}/approve`), t("saved"));
  const release = useApiAction((visibility: string) => api.post(`/admin/calibration/runs/${run.id}/release`, { visibility }), t("saved"));
  const { metrics } = run;
  return (
    <li className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium break-all">{run.modelConfiguration?.modelId ?? "-"}</p>
        <Badge variant="outline">{t("promptVersion", { version: run.promptVersion?.version ?? 0 })}</Badge>
        <Badge variant="outline">{t(`splits.${run.split}`)}</Badge>
        <Badge variant="secondary">{t(`runStatus.${run.status}`)}</Badge>
      </div>
      {run.errorMessage && <p role="alert" className="text-destructive">{run.errorMessage}</p>}
      {metrics && (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div><dt className="text-muted-foreground">{t("samples")}</dt><dd className="font-medium tabular-nums">{metrics.count} / {metrics.targets.samples}</dd></div>
            <div><dt className="text-muted-foreground">{t("mae")}</dt><dd className="font-medium tabular-nums">{metrics.mae?.toFixed(2) ?? "-"} / {metrics.targets.mae}</dd></div>
            <div><dt className="text-muted-foreground">{t("withinOne")}</dt><dd className="font-medium tabular-nums">{percent(metrics.withinOne)} / {percent(metrics.targets.withinOne)}</dd></div>
            <div><dt className="text-muted-foreground">{t("withinHalf")}</dt><dd className="font-medium tabular-nums">{percent(metrics.withinHalf)}</dd></div>
            <div><dt className="text-muted-foreground">{t("exact")}</dt><dd className="font-medium tabular-nums">{percent(metrics.exact)}</dd></div>
          </dl>
          <p className={metrics.meetsTargets ? "text-success flex items-center gap-1.5 font-medium" : "text-warning flex items-center gap-1.5 font-medium"}>
            {metrics.meetsTargets ? <CheckCircle2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
            {metrics.meetsTargets ? t("meetsTargets") : t("missesTargets")}
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {run.status === "COMPLETED" && canApprove && !run.instructorApprovedAt && <ConfirmButton label={t("approveRun")} title={t("approveRun")} description={t("approveRunBody")} onConfirm={() => approve.mutate()} />}
        {run.instructorApprovedAt && <Badge>{t("approved")}</Badge>}
        {canRelease && run.status === "COMPLETED" && (
          <>
            <ConfirmButton label={t("releaseInternal")} title={t("releaseInternal")} description={t("releaseInternalBody")} onConfirm={() => release.mutate("INTERNAL")} />
            <ConfirmButton label={t("releasePublic")} title={t("releasePublic")} description={t("releasePublicBody")} onConfirm={() => release.mutate("PUBLIC")} />
            <ConfirmButton label={t("closeGate")} title={t("closeGate")} description={t("closeGateBody")} onConfirm={() => release.mutate("HIDDEN")} />
          </>
        )}
      </div>
    </li>
  );
}

function DatasetDetail({ dataset }: { dataset: Dataset }) {
  const t = useTranslations("ai.calibration");
  const { hasPermission } = useAuth();
  const manage = hasPermission("calibration.manage");
  const criteria = dataset.skill === "WRITING" ? WRITING_CRITERIA(dataset.taskType) : SPEAKING_CRITERIA;
  const full = useApiQuery<DatasetFull>(`/admin/calibration/datasets/${dataset.id}`, { enabled: manage });
  const [open, setOpen] = useState(false);
  const add = useApiAction((body: object) => api.post(`/admin/calibration/datasets/${dataset.id}/samples`, body), t("saved"));
  const freeze = useApiAction(() => api.post(`/admin/calibration/datasets/${dataset.id}/freeze`), t("frozenDone"));
  const approveTargets = useApiAction(() => api.post(`/admin/calibration/datasets/${dataset.id}/approve-thresholds`), t("saved"));
  const run = useApiAction((body: object) => api.post(`/admin/calibration/datasets/${dataset.id}/runs`, body), t("runStarted"));
  const data = full.data;
  return (
    <div className="space-y-6">
      {manage && data && (
        <Card className="shadow-soft">
          <CardContent className="space-y-3">
            <p className="text-sm">{t("counts", { needsMarks: data.statusCounts.NEEDS_MARKS ?? 0, needsAdjudication: data.statusCounts.NEEDS_ADJUDICATION ?? 0, approved: data.statusCounts.APPROVED ?? 0 })}</p>
            <p className="text-muted-foreground text-sm">{t("targets", { samples: data.targetSamples, mae: Number(data.targetMae), within: percent(Number(data.targetWithinOne)) })} {data.thresholdsApprovedAt ? t("targetsApproved") : t("targetsNotApproved")}</p>
            <div className="flex flex-wrap gap-2">
              {!data.frozenAt && (
                <FormDialog
                  open={open}
                  onOpenChange={setOpen}
                  title={t("addSample")}
                  trigger={<Button variant="outline"><Plus aria-hidden /> {t("addSample")}</Button>}
                >
                  <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); add.mutate({ reference: String(form.get("reference")), split: String(form.get("split")), prompt: String(form.get("prompt")), responseText: String(form.get("responseText")), consentVersion: String(form.get("consentVersion")) }, { onSuccess: () => setOpen(false) }); }}>
                    <InputField name="reference" label={t("reference")} required hint={t("referenceHint")} />
                    <SelectBox name="split" label={t("split")} options={["TUNING", "VALIDATION", "TEST"].map((value) => ({ value, label: t(`splits.${value}`) }))} />
                    <TextAreaField name="prompt" label={t("taskPrompt")} rows={3} required />
                    <TextAreaField name="responseText" label={t("response")} rows={8} required />
                    <InputField name="consentVersion" label={t("consentVersion")} required />
                    <p className="text-muted-foreground text-sm">{t("deidentifyNote")}</p>
                    <Button type="submit" disabled={add.isPending}>{t("addSample")}</Button>
                  </form>
                </FormDialog>
              )}
              {!data.thresholdsApprovedAt && !data.frozenAt && hasPermission("assessments.review") && <ConfirmButton size="default" label={t("approveTargets")} title={t("approveTargets")} description={t("approveTargetsBody")} onConfirm={() => approveTargets.mutate()} />}
              {!data.frozenAt && <ConfirmButton size="default" label={t("freeze")} title={t("freeze")} description={t("freezeBody")} onConfirm={() => freeze.mutate()} />}
              {data.frozenAt && dataset.skill === "WRITING" && ["VALIDATION", "TEST"].map((split) => <Button key={split} variant="outline" disabled={run.isPending} onClick={() => run.mutate({ split, taskKey: "writing.assess" })}>{t("runOn", { split: t(`splits.${split}`) })}</Button>)}
              {data.frozenAt && <Badge>{t("frozen")}</Badge>}
            </div>
          </CardContent>
        </Card>
      )}
      {!dataset.frozenAt && hasPermission("calibration.mark") && (
        <section aria-labelledby="mark-heading">
          <h3 id="mark-heading" className="font-display mb-2 text-lg font-semibold">{t("toMark")}</h3>
          <p className="text-muted-foreground mb-3 text-sm">{t("markNote")}</p>
          <SampleQueue datasetId={dataset.id} kind="marking" criteria={criteria} />
        </section>
      )}
      {manage && !dataset.frozenAt && (
        <section aria-labelledby="adjudicate-heading">
          <h3 id="adjudicate-heading" className="font-display mb-2 text-lg font-semibold">{t("toAdjudicate")}</h3>
          <SampleQueue datasetId={dataset.id} kind="adjudication" criteria={criteria} />
        </section>
      )}
      {manage && data && data.runs.length > 0 && (
        <section aria-labelledby="runs-heading">
          <h3 id="runs-heading" className="font-display mb-2 text-lg font-semibold">{t("runs")}</h3>
          <ul className="bg-card shadow-soft divide-y rounded-xl border">{data.runs.map((row) => <RunCard key={row.id} run={row} canApprove={hasPermission("assessments.review")} canRelease={hasPermission("ai.band_release")} />)}</ul>
        </section>
      )}
    </div>
  );
}

export function CalibrationPage() {
  const t = useTranslations("ai.calibration");
  const labels = useLabels();
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const query = useApiPage<Dataset>("/admin/calibration/datasets", { page, pageSize: 20 });
  const create = useApiAction((body: object) => api.post("/admin/calibration/datasets", body), t("saved"));
  const [skill, setSkill] = useState("WRITING");
  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("intro")}
        actions={hasPermission("calibration.manage") && (
          <FormDialog open={open} onOpenChange={setOpen} title={t("newDataset")} trigger={<Button><Plus aria-hidden /> {t("newDataset")}</Button>}>
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); create.mutate({ version: String(form.get("version")), skill, ...(skill === "WRITING" ? { examType: String(form.get("examType")), taskType: String(form.get("taskType")) } : {}) }, { onSuccess: () => setOpen(false) }); }}>
              <InputField name="version" label={t("version")} required hint={t("versionHint")} />
              <SelectBox label={t("skill")} value={skill} onChange={(event) => setSkill(event.target.value)} options={["WRITING", "SPEAKING"].map((value) => ({ value, label: labels.skill(value) }))} />
              {skill === "WRITING" && (
                <>
                  <SelectBox name="examType" label={t("examType")} options={["ACADEMIC", "GENERAL_TRAINING"].map((value) => ({ value, label: labels.examType(value) }))} />
                  <SelectBox name="taskType" label={t("taskType")} options={["ACADEMIC_TASK_1", "GENERAL_TASK_1", "TASK_2"].map((value) => ({ value, label: t(`tasks.${value}`) }))} />
                </>
              )}
              <p className="text-muted-foreground text-sm">{t("defaultTargets")}</p>
              <Button type="submit" disabled={create.isPending}>{t("newDataset")}</Button>
            </form>
          </FormDialog>
        )}
      />
      <p className="bg-card mb-6 flex items-start gap-2 rounded-xl border p-4 text-sm"><Scale className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("standardsNote")}</p>
      <QueryBoundary query={query}>
        {({ items, meta }) => {
          const current = items.find((row) => row.id === selected);
          return items.length === 0 ? <Empty icon={<Scale aria-hidden />} title={t("none")} /> : (
            <div className="space-y-6">
              <Card className="shadow-soft">
                <CardHeader><CardTitle className="font-display text-lg">{t("datasets")}</CardTitle></CardHeader>
                <CardContent>
                  <ul className="divide-y">
                    {items.map((row) => (
                      <li key={row.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="font-medium break-all">{row.version}</p>
                          <p className="text-muted-foreground">{labels.skill(row.skill)}{row.examType ? ` · ${labels.examType(row.examType)}` : ""}{row.taskType ? ` · ${t(`tasks.${row.taskType}`)}` : ""}{row._count ? ` · ${t("sampleCount", { count: row._count.samples })}` : ""}</p>
                        </div>
                        {row.frozenAt && <Badge>{t("frozen")}</Badge>}
                        <Button size="sm" variant={selected === row.id ? "default" : "outline"} aria-pressed={selected === row.id} onClick={() => setSelected(row.id)}>{t("open")}</Button>
                      </li>
                    ))}
                  </ul>
                  <Pagination meta={meta} onPage={setPage} />
                </CardContent>
              </Card>
              {current && <DatasetDetail key={current.id} dataset={current} />}
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
