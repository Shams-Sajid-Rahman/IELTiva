"use client";

import { AlertTriangle, Download, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiRequestError } from "@/lib/api-client";
import { ReportRow, useReportFiles } from "../analytics/reports";
import { formatDate } from "../platform/format";
import { useApiAction, useApiQuery } from "../platform/hooks";
import { ConfirmButton, FormDialog, InputField, QueryBoundary } from "../platform/ui";

type Summary = { deletion: { requestedAt: string; scheduledFor: string } | null; hasPassword: boolean; retention: { recordingsDays: number; exportsDays: number; cancelWindowDays: number } };

function DeleteAccount({ summary }: { summary: Summary }) {
  const t = useTranslations("privacyControls");
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useApiAction((body: { password?: string; confirmation: string }) => api.post("/privacy/deletion", body), t("deletionScheduled"));
  return (
    <FormDialog open={open} onOpenChange={setOpen} title={t("deleteTitle")} description={t("deleteIntro", { days: summary.retention.cancelWindowDays })} trigger={<Button variant="destructive"><Trash2 aria-hidden /> {t("deleteAccount")}</Button>}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          request.mutate(
            { ...(summary.hasPassword ? { password } : {}), confirmation },
            { onSuccess: () => setOpen(false), onError: (caught) => setError(caught instanceof ApiRequestError ? caught.message : t("failed")) },
          );
        }}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{t("deleteRemoves")}</li>
          <li>{t("deleteKeeps")}</li>
        </ul>
        {summary.hasPassword && <InputField label={t("password")} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />}
        <InputField label={t("typeDelete")} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required />
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <Button type="submit" variant="destructive" disabled={request.isPending || confirmation !== "DELETE"}>{t("confirmDelete")}</Button>
      </form>
    </FormDialog>
  );
}

/** A student's own copy of their data, and the way to delete their account. */
export function DataControls() {
  const t = useTranslations("privacyControls");
  const summary = useApiQuery<Summary>("/privacy");
  const files = useReportFiles();
  const exportData = useApiAction(() => api.post("/privacy/export"), t("exportRequested"));
  const cancel = useApiAction(() => api.delete("/privacy/deletion"), t("deletionCanceled"));
  return (
    <div className="mt-6 space-y-6">
      <Card className="shadow-soft">
        <CardHeader><CardTitle className="font-display text-lg">{t("exportTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">{t("exportIntro", { days: summary.data?.retention.exportsDays ?? 7 })}</p>
          <Button variant="outline" disabled={exportData.isPending} onClick={() => exportData.mutate()}><Download aria-hidden /> {t("exportButton")}</Button>
          <QueryBoundary query={files} loading={null}>
            {(rows) => {
              const exports = rows.filter((row) => row.kind === "DATA_EXPORT").slice(0, 3);
              return exports.length ? <ul className="divide-y border-t">{exports.map((row) => <ReportRow key={row.id} row={row} />)}</ul> : null;
            }}
          </QueryBoundary>
        </CardContent>
      </Card>
      <QueryBoundary query={summary} loading={null}>
        {(data) => (
          <Card className="shadow-soft">
            <CardHeader><CardTitle className="font-display text-lg">{t("deleteSection")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.deletion ? (
                <>
                  <p role="status" className="flex items-start gap-2 text-sm font-medium"><AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden /> {t("scheduledFor", { date: formatDate(data.deletion.scheduledFor) })}</p>
                  <ConfirmButton label={t("keepAccount")} title={t("keepTitle")} description={t("keepBody")} confirmLabel={t("keepAccount")} onConfirm={() => cancel.mutate()} />
                </>
              ) : (
                <>
                  <p className="text-muted-foreground text-sm">{t("deleteSummary", { days: data.retention.cancelWindowDays })}</p>
                  <DeleteAccount summary={data} />
                </>
              )}
            </CardContent>
          </Card>
        )}
      </QueryBoundary>
    </div>
  );
}
