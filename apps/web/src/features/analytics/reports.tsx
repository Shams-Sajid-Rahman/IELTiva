"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiRequestError } from "@/lib/api-client";
import { downloadFromApi } from "@/lib/download";
import { formatDate } from "../platform/format";
import { useApiAction } from "../platform/hooks";
import { QueryBoundary } from "../platform/ui";

export type ReportFile = { id: string; kind: "PROGRESS_REPORT" | "DATA_EXPORT"; status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED"; errorMessage: string | null; byteSize: number | null; expiresAt: string | null; createdAt: string };

export function useReportFiles() {
  return useQuery({
    queryKey: ["/reports"],
    queryFn: () => api.get<ReportFile[]>("/reports"),
    // Only asks again while a file is still being made.
    refetchInterval: (state) => (state.state.data?.some((row) => row.status === "PENDING" || row.status === "PROCESSING") ? 4000 : false),
  });
}

export function ReportRow({ row }: { row: ReportFile }) {
  const t = useTranslations("analytics.reports");
  const open = row.status === "PENDING" || row.status === "PROCESSING";
  const fallback = row.kind === "DATA_EXPORT" ? "ieltiva-data-export.json" : "ieltiva-progress.html";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <FileText className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0">{t(`kinds.${row.kind}`)} <span className="text-muted-foreground">· {formatDate(row.createdAt)}</span>{row.expiresAt && <span className="text-muted-foreground block text-xs">{t("expires", { date: formatDate(row.expiresAt) })}</span>}</span>
      </span>
      {row.status === "COMPLETED" ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void downloadFromApi(`/reports/${row.id}/download`, fallback).catch((error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : t("failed")))}
        >
          <Download aria-hidden /> {t("download")}
        </Button>
      ) : open ? (
        <span role="status" className="text-muted-foreground flex items-center gap-1.5"><Loader2 className="size-4 animate-spin" aria-hidden /> {t("making")}</span>
      ) : (
        <Badge variant="outline">{t("failedShort")}</Badge>
      )}
    </li>
  );
}

/** A progress report the student can save, made in the background and removed automatically after a few days. */
export function ProgressReports() {
  const t = useTranslations("analytics.reports");
  const files = useReportFiles();
  const request = useApiAction(() => api.post("/reports", { kind: "PROGRESS_REPORT" }), t("requested"));
  return (
    <section aria-labelledby="reports-heading" className="bg-card shadow-soft rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="reports-heading" className="font-display text-lg font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("intro")}</p>
        </div>
        <Button variant="outline" disabled={request.isPending} onClick={() => request.mutate()}><FileText aria-hidden /> {t("make")}</Button>
      </div>
      <QueryBoundary query={files} loading={null}>
        {(rows) => {
          const reports = rows.filter((row) => row.kind === "PROGRESS_REPORT").slice(0, 5);
          return reports.length ? <ul className="mt-3 divide-y border-t">{reports.map((row) => <ReportRow key={row.id} row={row} />)}</ul> : null;
        }}
      </QueryBoundary>
    </section>
  );
}
