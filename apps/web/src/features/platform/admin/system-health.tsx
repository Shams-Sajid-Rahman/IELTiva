"use client";

import { Activity, AlertTriangle, CheckCircle2, Database, HardDrive, Server, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "../format";
import { useApiQuery } from "../hooks";
import { Empty, PageHeader, QueryBoundary, TableFrame, tdClass, thClass } from "../ui";

type Check = { ok: boolean; latencyMs: number | null } | null;
type Overview = {
  generatedAt: string;
  uptimeSeconds: number;
  checks: { database: Check; redis: Check; storage: { kind: string; ok: boolean; latencyMs: number | null } };
  queues: { name: string; paused: boolean; waiting: number; active: number; delayed: number; failed: number; completed: number }[];
  workers: { host: string; pid: number; startedAt: string; beatAt: string; healthy: boolean }[];
  events: { source: string; code: string; count: number; lastSeen: string | null }[];
  ai: { outcomes: Record<string, number>; jobs: Record<string, number>; stuckJobs: number };
  backlog: { pendingPayments: number; overdueRecordings: number; overdueReports: number };
  cache: { entries: number; hits: number; misses: number; sharedAvailable: boolean };
};

function CheckCard({ label, check, icon, detail }: { label: string; check: Check; icon: React.ReactNode; detail?: string }) {
  const t = useTranslations("operations");
  const state = check === null ? "off" : check.ok ? "ok" : "down";
  return (
    <div className="bg-card shadow-soft rounded-xl border p-4">
      <div className="flex items-center gap-2 font-medium [&_svg]:size-4">{icon} {label}</div>
      <p className="mt-2 flex items-center gap-1.5 text-sm">
        {state === "ok" ? <CheckCircle2 className="text-success size-4" aria-hidden /> : state === "down" ? <XCircle className="text-destructive size-4" aria-hidden /> : <AlertTriangle className="text-warning size-4" aria-hidden />}
        {t(`state.${state}`)}{check?.latencyMs != null ? ` · ${check.latencyMs} ms` : ""}
      </p>
      {detail && <p className="text-muted-foreground mt-1 text-xs">{detail}</p>}
    </div>
  );
}

export function SystemHealthPage() {
  const t = useTranslations("operations");
  const query = useApiQuery<Overview>("/admin/operations", { refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} />
      <QueryBoundary query={query}>
        {(data) => (
          <div className="space-y-8">
            <p className="text-muted-foreground text-sm">{t("updated", { time: formatDateTime(data.generatedAt), hours: Math.floor(data.uptimeSeconds / 3600) })}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <CheckCard label={t("database")} check={data.checks.database} icon={<Database aria-hidden />} />
              <CheckCard label={t("redis")} check={data.checks.redis} icon={<Server aria-hidden />} detail={data.checks.redis === null ? t("redisOff") : undefined} />
              <CheckCard label={t("storage")} check={data.checks.storage.kind === "unavailable" ? { ok: false, latencyMs: null } : data.checks.storage} icon={<HardDrive aria-hidden />} detail={t(`storageKind.${data.checks.storage.kind}`)} />
              <CheckCard label={t("workers")} check={data.checks.redis === null ? null : { ok: data.workers.some((row) => row.healthy), latencyMs: null }} icon={<Activity aria-hidden />} detail={t("workerCount", { count: data.workers.filter((row) => row.healthy).length })} />
            </div>

            <section aria-labelledby="queues-heading">
              <h2 id="queues-heading" className="font-display mb-3 text-xl font-semibold">{t("queues")}</h2>
              {data.queues.length === 0 ? <Empty title={t("noQueues")} /> : (
                <TableFrame label={t("queues")}>
                  <thead><tr>{[t("queue"), t("waiting"), t("active"), t("delayed"), t("failed"), t("completed")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
                  <tbody>{data.queues.map((row) => <tr key={row.name}><td className={tdClass}>{row.name.replace("ieltiva-", "")}{row.paused && <Badge variant="outline" className="ml-2">{t("paused")}</Badge>}</td><td className={tdClass}>{row.waiting}</td><td className={tdClass}>{row.active}</td><td className={tdClass}>{row.delayed}</td><td className={tdClass}>{row.failed}</td><td className={tdClass}>{row.completed}</td></tr>)}</tbody>
                </TableFrame>
              )}
            </section>

            <section aria-labelledby="backlog-heading">
              <h2 id="backlog-heading" className="font-display mb-3 text-xl font-semibold">{t("attention")}</h2>
              <ul className="bg-card shadow-soft divide-y rounded-xl border text-sm">
                {[
                  { label: t("stuckJobs"), value: data.ai.stuckJobs },
                  { label: t("pendingPayments"), value: data.backlog.pendingPayments },
                  { label: t("overdueRecordings"), value: data.backlog.overdueRecordings },
                  { label: t("overdueReports"), value: data.backlog.overdueReports },
                ].map((row) => (
                  <li key={row.label} className="flex items-center justify-between gap-3 p-3"><span>{row.label}</span><Badge variant={row.value > 0 ? "destructive" : "outline"}>{row.value}</Badge></li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="errors-heading">
              <h2 id="errors-heading" className="font-display mb-3 text-xl font-semibold">{t("errors")}</h2>
              {data.events.length === 0 ? <Empty title={t("noErrors")} /> : (
                <TableFrame label={t("errors")}>
                  <thead><tr>{[t("source"), t("code"), t("count"), t("lastSeen")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
                  <tbody>{data.events.map((row) => <tr key={`${row.source}-${row.code}`}><td className={tdClass}>{t.has(`sources.${row.source}`) ? t(`sources.${row.source}`) : row.source}</td><td className={`${tdClass} break-all`}>{row.code}</td><td className={tdClass}>{row.count}</td><td className={tdClass}>{formatDateTime(row.lastSeen)}</td></tr>)}</tbody>
                </TableFrame>
              )}
            </section>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
