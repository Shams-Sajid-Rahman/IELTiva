import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Cache } from "../cache.js";
import type { RevenueService } from "../billing/revenue.service.js";

const DAY = 86_400_000;
const CACHE_SECONDS = 300;
/** A performance average is hidden when fewer students than this are behind it, so it can't point at one person. */
export const MIN_GROUP_SIZE = 5;

type DayCount = { day: Date; count: bigint };

const toSeries = (rows: DayCount[]) => rows.map((row) => ({ day: row.day.toISOString().slice(0, 10), count: Number(row.count) }));
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * Platform totals for staff. This returns counts and averages only: no names, emails or individual records,
 * and averages built from too few students are withheld.
 */
export function createAdminAnalyticsService({ prisma, cache, revenue }: { prisma: PrismaClient; cache: Cache; revenue: RevenueService }) {
  async function build(days: number) {
    const now = Date.now();
    const since = new Date(now - days * DAY);
    const seen = (ms: number) => prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(DISTINCT user_id)::bigint AS count FROM user_sessions WHERE last_seen_at >= ${new Date(now - ms)}`;

    const [day, week, month, totalStudents, newStudents, signups, activeSeries] = await Promise.all([
      seen(DAY),
      seen(7 * DAY),
      seen(30 * DAY),
      prisma.user.count({ where: { deletedAt: null, userRoles: { some: { role: { code: "STUDENT" } } } } }),
      prisma.user.count({ where: { deletedAt: null, createdAt: { gte: since }, userRoles: { some: { role: { code: "STUDENT" } } } } }),
      prisma.$queryRaw<DayCount[]>`SELECT date_trunc('day', created_at) AS day, COUNT(*)::bigint AS count FROM users WHERE deleted_at IS NULL AND created_at >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<DayCount[]>`
        SELECT day, COUNT(DISTINCT user_id)::bigint AS count FROM (
          SELECT date_trunc('day', created_at) AS day, user_id FROM exam_attempts WHERE created_at >= ${since}
          UNION ALL
          SELECT date_trunc('day', occurred_at) AS day, user_id FROM user_learning_history WHERE occurred_at >= ${since}
        ) activity GROUP BY 1 ORDER BY 1`,
    ]);

    const [enrollmentStatus, newEnrollments, topCourses] = await Promise.all([
      prisma.userEnrollment.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.userEnrollment.count({ where: { createdAt: { gte: since } } }),
      prisma.$queryRaw<{ title: string; count: bigint }[]>`
        SELECT c.title, COUNT(*)::bigint AS count FROM user_enrollments e JOIN courses c ON c.id = e.course_id
        WHERE e.status <> 'CANCELED' GROUP BY c.title ORDER BY count DESC LIMIT 10`,
    ]);

    const [attemptStatus, attemptSeries, skillRows, topExams] = await Promise.all([
      prisma.examAttempt.groupBy({ by: ["status", "mode"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.$queryRaw<DayCount[]>`SELECT date_trunc('day', created_at) AS day, COUNT(*)::bigint AS count FROM exam_attempts WHERE created_at >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ skill: string; sections: bigint; students: bigint; raw: bigint | null; max: bigint | null; seconds: bigint | null }[]>`
        SELECT s.skill::text AS skill, COUNT(*)::bigint AS sections, COUNT(DISTINCT a.user_id)::bigint AS students,
               SUM(sa.raw_score) FILTER (WHERE sa.max_score > 0)::bigint AS raw, SUM(sa.max_score) FILTER (WHERE sa.max_score > 0)::bigint AS max, SUM(sa.time_spent_seconds)::bigint AS seconds
        FROM section_attempts sa JOIN exam_sections s ON s.id = sa.section_id JOIN exam_attempts a ON a.id = sa.exam_attempt_id
        WHERE sa.status IN ('SUBMITTED', 'EXPIRED') AND sa.submitted_at >= ${since}
        GROUP BY 1`,
      prisma.$queryRaw<{ title: string; count: bigint }[]>`
        SELECT x.title, COUNT(*)::bigint AS count FROM exam_attempts a JOIN exam_versions v ON v.id = a.exam_version_id JOIN exams x ON x.id = v.exam_id
        WHERE a.created_at >= ${since} GROUP BY x.title ORDER BY count DESC LIMIT 10`,
    ]);

    const [jobStatus, jobSeries, turnaround, tutorMessages, consentRows] = await Promise.all([
      prisma.aIAssessmentJob.groupBy({ by: ["taskKey", "status"], where: { queuedAt: { gte: since } }, _count: { _all: true } }),
      prisma.$queryRaw<DayCount[]>`SELECT date_trunc('day', queued_at) AS day, COUNT(*)::bigint AS count FROM ai_assessment_jobs WHERE queued_at >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<{ seconds: number | null }[]>`SELECT AVG(EXTRACT(EPOCH FROM finished_at - queued_at))::float AS seconds FROM ai_assessment_jobs WHERE status = 'COMPLETED' AND queued_at >= ${since}`,
      prisma.tutorMessage.count({ where: { role: "user", createdAt: { gte: since } } }),
      prisma.userConsent.groupBy({ by: ["type"], where: { revokedAt: null }, _count: { _all: true } }),
    ]);

    const [activeEntitlements, creditsUsed, expiringSoon] = await Promise.all([
      prisma.userEntitlement.groupBy({ by: ["featureKey"], where: { status: "ACTIVE" }, _count: { _all: true } }),
      prisma.$queryRaw<{ feature: string; used: bigint }[]>`
        SELECT feature_key AS feature, COUNT(*) FILTER (WHERE reason <> 'purchase' AND reason <> 'released')::bigint - COUNT(*) FILTER (WHERE reason = 'released')::bigint AS used
        FROM credit_ledger WHERE created_at >= ${since} GROUP BY 1`,
      prisma.userEntitlement.count({ where: { status: "ACTIVE", endsAt: { gte: new Date(now), lt: new Date(now + 7 * DAY) } } }),
    ]);

    const count = (rows: { status: string; _count: { _all: number } }[], status: string) => rows.filter((row) => row.status === status).reduce((sum, row) => sum + row._count._all, 0);
    const submitted = count(attemptStatus, "SUBMITTED");
    const timedOut = count(attemptStatus, "EXPIRED");
    const abandoned = count(attemptStatus, "ABANDONED");
    const jobsTotal = jobStatus.reduce((sum, row) => sum + row._count._all, 0);
    const jobsFailed = count(jobStatus, "FAILED");

    return {
      days,
      minGroupSize: MIN_GROUP_SIZE,
      activity: { activeToday: Number(day[0]?.count ?? 0), activeWeek: Number(week[0]?.count ?? 0), activeMonth: Number(month[0]?.count ?? 0), totalStudents, newStudents, signups: toSeries(signups), dailyActive: toSeries(activeSeries) },
      enrollments: {
        active: enrollmentStatus.find((row) => row.status === "ACTIVE")?._count._all ?? 0,
        completed: enrollmentStatus.find((row) => row.status === "COMPLETED")?._count._all ?? 0,
        canceled: enrollmentStatus.find((row) => row.status === "CANCELED")?._count._all ?? 0,
        new: newEnrollments,
        topCourses: topCourses.map((row) => ({ title: row.title, count: Number(row.count) })),
      },
      practice: {
        started: attemptStatus.reduce((sum, row) => sum + row._count._all, 0),
        submitted,
        timedOut,
        abandoned,
        mocks: attemptStatus.filter((row) => row.mode === "MOCK").reduce((sum, row) => sum + row._count._all, 0),
        completionRate: percent(submitted, submitted + timedOut + abandoned),
        series: toSeries(attemptSeries),
        skills: skillRows.map((row) => {
          const enough = Number(row.students) >= MIN_GROUP_SIZE;
          return { skill: row.skill, sections: Number(row.sections), minutes: Math.round(Number(row.seconds ?? 0) / 60), withheld: !enough, averageAccuracy: enough && row.max ? percent(Number(row.raw ?? 0), Number(row.max)) : null };
        }),
        topExams: topExams.map((row) => ({ title: row.title, count: Number(row.count) })),
      },
      assessments: {
        total: jobsTotal,
        failed: jobsFailed,
        failureRate: percent(jobsFailed, jobsTotal),
        averageSeconds: turnaround[0]?.seconds === null || turnaround[0]?.seconds === undefined ? null : Math.round(turnaround[0].seconds),
        tutorMessages,
        series: toSeries(jobSeries),
        byTask: [...new Set(jobStatus.map((row) => row.taskKey))].map((taskKey) => ({
          taskKey,
          completed: jobStatus.filter((row) => row.taskKey === taskKey && row.status === "COMPLETED").reduce((sum, row) => sum + row._count._all, 0),
          failed: jobStatus.filter((row) => row.taskKey === taskKey && row.status === "FAILED").reduce((sum, row) => sum + row._count._all, 0),
          open: jobStatus.filter((row) => row.taskKey === taskKey && (row.status === "PENDING" || row.status === "PROCESSING")).reduce((sum, row) => sum + row._count._all, 0),
        })),
        consents: Object.fromEntries(consentRows.map((row) => [row.type, row._count._all])),
      },
      packages: {
        expiringSoon,
        features: [...new Set([...activeEntitlements.map((row) => row.featureKey), ...creditsUsed.map((row) => row.feature)])].map((featureKey) => ({
          featureKey,
          activeEntitlements: activeEntitlements.find((row) => row.featureKey === featureKey)?._count._all ?? 0,
          usedInPeriod: Math.max(0, Number(creditsUsed.find((row) => row.feature === featureKey)?.used ?? 0)),
        })),
      },
    };
  }

  return {
    overview: (days: number) => cache.getOrSet("admin", `analytics:${days}`, CACHE_SECONDS, () => build(days)),
    revenue: (days: number) => cache.getOrSet("admin", `revenue:${days}`, CACHE_SECONDS, () => revenue.summary({ days })),
  };
}

export type AdminAnalyticsService = ReturnType<typeof createAdminAnalyticsService>;
