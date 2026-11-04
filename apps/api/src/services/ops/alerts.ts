import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Logger } from "../../utils/logger.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Enough failures in an hour to be a pattern rather than a one-off. */
const ERROR_THRESHOLD = 10;

type Notify = (userId: string, message: { type: "SYSTEM"; title: string; body: string; link?: string; dedupeKey?: string }) => Promise<void>;

/**
 * Checks for known problems and tells staff in the app, at most once an hour for each.
 * This can't report the worker itself being down, so production also needs an outside uptime check (see OPERATIONS_RUNBOOK.md).
 */
export function createAlertChecker({ prisma, notify, logger }: { prisma: PrismaClient; notify: Notify; logger: Pick<Logger, "warn"> }) {
  return async function checkAlerts(now = new Date()) {
    const nowMs = now.getTime();
    const [events, stuckJobs, pendingPayments, overdueRecordings, reviewPayments, openCritical] = await Promise.all([
      prisma.operationalEvent.groupBy({ by: ["source"], where: { bucketStart: { gte: new Date(nowMs - HOUR) } }, _sum: { count: true } }),
      prisma.aIAssessmentJob.count({ where: { status: { in: ["PENDING", "PROCESSING"] }, queuedAt: { lt: new Date(nowMs - HOUR) } } }),
      prisma.paymentTransaction.count({ where: { status: "PENDING", createdAt: { lt: new Date(nowMs - 2 * HOUR) } } }),
      prisma.speakingSubmission.count({ where: { audioStorageKey: { not: null }, audioDeleteAfter: { lt: new Date(nowMs - DAY) } } }),
      prisma.paymentTransaction.count({ where: { failureReason: { startsWith: "needs_review" }, updatedAt: { gte: new Date(nowMs - DAY) } } }),
      prisma.incident.count({ where: { severity: "CRITICAL", status: { not: "RESOLVED" } } }),
    ]);

    const alerts: { code: string; title: string; body: string; link: string }[] = [];
    for (const row of events) {
      const count = row._sum.count ?? 0;
      if (count >= ERROR_THRESHOLD) alerts.push({ code: `errors-${row.source}`, title: `Errors in ${row.source}`, body: `${count} errors in the last hour.`, link: "/admin/operations" });
    }
    if (stuckJobs > 0) alerts.push({ code: "stuck-jobs", title: "AI jobs are stuck", body: `${stuckJobs} AI jobs have waited more than an hour. Check the worker and Redis.`, link: "/admin/operations" });
    if (pendingPayments > 0) alerts.push({ code: "pending-payments", title: "Payments unconfirmed", body: `${pendingPayments} payments are still unconfirmed after two hours.`, link: "/admin/payments" });
    if (reviewPayments > 0) alerts.push({ code: "payment-mismatch", title: "Payments need review", body: `${reviewPayments} payments had an amount or currency that didn't match. Nothing was granted for them.`, link: "/admin/payments" });
    // A retention failure is a privacy problem, not only a technical one.
    if (overdueRecordings > 0) alerts.push({ code: "overdue-recordings", title: "Recordings past their deletion date", body: `${overdueRecordings} recordings should have been deleted. Check the worker and storage.`, link: "/admin/operations" });
    if (openCritical > 0) alerts.push({ code: "critical-incident", title: "Critical incident still open", body: `${openCritical} critical incidents aren't resolved.`, link: "/admin/release" });
    if (alerts.length === 0) return 0;

    const staff = await prisma.user.findMany({
      where: { status: "ACTIVE", userRoles: { some: { role: { permissions: { some: { permission: { code: "operations.read" } } } } } } },
      select: { id: true },
      take: 50,
    });
    const hour = Math.floor(nowMs / HOUR);
    for (const alert of alerts) {
      logger.warn({ alert: alert.code }, alert.title);
      for (const person of staff) {
        await notify(person.id, { type: "SYSTEM", title: alert.title, body: alert.body, link: alert.link, dedupeKey: `ops-alert:${alert.code}:${person.id}:${hour}` });
      }
    }
    return alerts.length;
  };
}
