import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { AppError } from "../../utils/app-error.js";
import type { Logger } from "../../utils/logger.js";
import type { StudentAnalyticsService } from "../analytics/student.service.js";
import type { JobQueues } from "../queue/jobs.js";
import type { PrivateStorage } from "../storage/private-storage.js";
import { renderProgressReport } from "./progress-report.js";

const DAY = 86_400_000;
const MAX_REQUESTS_PER_DAY = 5;
const DEFAULT_RETENTION_DAYS = 7;
const LINK_SECONDS = 120;

type Kind = "PROGRESS_REPORT" | "DATA_EXPORT";
/** Builds a data export. Provided by the privacy service, so this file doesn't need to know what an export holds. */
export type ExportBuilder = (userId: string) => Promise<unknown>;

/** Student files made in the background: progress reports and personal data exports. They're private and expire on their own. */
export function createReportService({ prisma, storage, queues, analytics, buildExport, logger }: { prisma: PrismaClient; storage: PrivateStorage; queues: JobQueues | null; analytics: StudentAnalyticsService; buildExport: ExportBuilder; logger: Pick<Logger, "warn" | "error"> }) {
  const view = (row: { id: string; kind: string; status: string; errorMessage: string | null; byteSize: number | null; expiresAt: Date | null; createdAt: Date; finishedAt: Date | null }) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    errorMessage: row.errorMessage,
    byteSize: row.byteSize,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  });

  async function retentionDays() {
    const setting = await prisma.platformSetting.findUnique({ where: { key: "retention.data_exports_days" } });
    return typeof setting?.value === "number" ? setting.value : DEFAULT_RETENTION_DAYS;
  }

  async function produce(row: { id: string; userId: string; kind: Kind }) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (row.kind === "DATA_EXPORT") {
      const data = await buildExport(row.userId);
      return { content: Buffer.from(JSON.stringify(data, null, 2)), contentType: "application/json", extension: "json", fileName: `ieltiva-data-export-${stamp}.json` };
    }
    const actor = { userId: row.userId } as Actor;
    const [data, profile] = await Promise.all([analytics.overview(actor, 90), prisma.userProfile.findUnique({ where: { userId: row.userId }, select: { firstName: true, lastName: true } })]);
    const name = `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim();
    return { content: Buffer.from(renderProgressReport(data, name)), contentType: "text/html; charset=utf-8", extension: "html", fileName: `ieltiva-progress-${stamp}.html` };
  }

  /** Safe to run twice: a report that's already finished is left alone. */
  async function generate(reportId: string) {
    const row = await prisma.generatedReport.findUnique({ where: { id: reportId } });
    if (!row || row.status === "COMPLETED") return;
    await prisma.generatedReport.update({ where: { id: row.id }, data: { status: "PROCESSING" } });
    const file = await produce({ id: row.id, userId: row.userId, kind: row.kind });
    const storageKey = `reports/${row.userId}/${row.id}.${file.extension}`;
    await storage.put(storageKey, file.content, { contentType: file.contentType });
    await prisma.generatedReport.update({
      where: { id: row.id },
      data: { status: "COMPLETED", storageKey, contentType: file.contentType, fileName: file.fileName, byteSize: file.content.length, finishedAt: new Date(), expiresAt: new Date(Date.now() + (await retentionDays()) * DAY), errorMessage: null },
    });
  }

  return {
    generate,

    markFailed: (reportId: string) => prisma.generatedReport.update({ where: { id: reportId }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: "This file couldn't be made. Please try again." } }),

    async request(actor: Actor, kind: Kind) {
      const open = await prisma.generatedReport.findFirst({ where: { userId: actor.userId, kind, status: { in: ["PENDING", "PROCESSING"] }, createdAt: { gte: new Date(Date.now() - DAY) } } });
      if (open) return view(open);
      const today = await prisma.generatedReport.count({ where: { userId: actor.userId, createdAt: { gte: new Date(Date.now() - DAY) } } });
      if (today >= MAX_REQUESTS_PER_DAY) throw new AppError(429, "RATE_LIMITED", "You've made several of these today. Please try again tomorrow.");
      const row = await prisma.generatedReport.create({ data: { userId: actor.userId, kind } });
      if (queues) {
        try {
          await queues.add("report.generate", { reportId: row.id }, row.id);
          return view(row);
        } catch {
          logger.warn({ reportId: row.id }, "Couldn't queue a report, so it's being made directly");
        }
      }
      // Without a queue the file is made now, so this still works on a machine with no Redis.
      try {
        await generate(row.id);
      } catch (error) {
        logger.error({ err: error, reportId: row.id }, "Report failed");
        await prisma.generatedReport.update({ where: { id: row.id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: "This file couldn't be made. Please try again." } });
      }
      return view(await prisma.generatedReport.findUniqueOrThrow({ where: { id: row.id } }));
    },

    async list(actor: Actor) {
      const rows = await prisma.generatedReport.findMany({ where: { userId: actor.userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" }, take: 20 });
      return rows.map(view);
    },

    /** Checks ownership, then hands back a short-lived link where the storage can make one, or the file itself. */
    async download(actor: Actor, reportId: string) {
      const row = await prisma.generatedReport.findFirst({ where: { id: reportId, userId: actor.userId } });
      if (!row?.storageKey || row.status !== "COMPLETED" || (row.expiresAt && row.expiresAt < new Date())) throw new AppError(404, "NOT_FOUND", "This file isn't available.");
      const fileName = row.fileName ?? "ieltiva-file";
      const contentType = row.contentType ?? "application/octet-stream";
      const url = storage.signedDownloadUrl ? await storage.signedDownloadUrl(row.storageKey, { expiresSeconds: LINK_SECONDS, fileName, contentType }) : null;
      if (url) return { url };
      const data = await storage.get(row.storageKey);
      if (!data) throw new AppError(404, "NOT_FOUND", "This file isn't available.");
      return { data, contentType, fileName };
    },

    /** Removes the file first and the record after, so a storage failure is retried on the next run. */
    async deleteExpired() {
      const rows = await prisma.generatedReport.findMany({ where: { expiresAt: { lte: new Date() } }, take: 200, select: { id: true, storageKey: true } });
      for (const row of rows) {
        if (row.storageKey) await storage.delete(row.storageKey);
        await prisma.generatedReport.delete({ where: { id: row.id } });
      }
      return rows.length;
    },

    /** Used when an account is deleted. */
    async deleteAllFor(userId: string) {
      const rows = await prisma.generatedReport.findMany({ where: { userId }, select: { id: true, storageKey: true } });
      for (const row of rows) {
        if (row.storageKey) await storage.delete(row.storageKey);
        await prisma.generatedReport.delete({ where: { id: row.id } });
      }
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
