import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { redisConnection } from "../ai/queue.js";
import type { Cache } from "../cache.js";
import { ALL_QUEUE_NAMES, HEARTBEAT_PREFIX, HEARTBEAT_SECONDS } from "../queue/jobs.js";
import type { PrivateStorage } from "../storage/private-storage.js";

const DAY = 86_400_000;
const CHECK_TIMEOUT_MS = 3_000;

const withTimeout = async <T>(work: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS); })]);
  } finally {
    clearTimeout(timer);
  }
};

async function timed(work: () => Promise<unknown>) {
  const started = Date.now();
  try {
    await withTimeout(work());
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: null };
  }
}

/** What staff need to see whether IELTiva is working. Nothing here identifies a student. */
export function createOperationsService({ prisma, redis, redisUrl, storage, cache }: { prisma: PrismaClient; redis: Redis | null; redisUrl: string | undefined; storage: PrivateStorage; cache: Cache }) {
  // Opened once and reused, because a monitoring page shouldn't open new connections on every refresh.
  const queues = redisUrl ? ALL_QUEUE_NAMES.map((name) => new Queue(name, { connection: redisConnection(redisUrl, { forWorker: false }) })) : [];
  for (const queue of queues) queue.on("error", () => undefined);

  async function queueStats() {
    if (!redis || redis.status !== "ready") return [];
    return withTimeout(
      Promise.all(
        queues.map(async (queue) => {
          const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
          const paused = await queue.isPaused();
          return { name: queue.name, paused, waiting: counts.waiting ?? 0, active: counts.active ?? 0, delayed: counts.delayed ?? 0, failed: counts.failed ?? 0, completed: counts.completed ?? 0 };
        }),
      ),
    ).catch(() => []);
  }

  async function workers() {
    if (!redis || redis.status !== "ready") return [];
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", `${HEARTBEAT_PREFIX}*`, "COUNT", 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0" && keys.length < 100);
    if (keys.length === 0) return [];
    const values = await redis.mget(...keys);
    return values.flatMap((value) => {
      if (!value) return [];
      const beat = JSON.parse(value) as { host: string; pid: number; startedAt: string; beatAt: string };
      return [{ ...beat, healthy: Date.now() - new Date(beat.beatAt).getTime() < HEARTBEAT_SECONDS * 2500 }];
    });
  }

  return {
    /** Liveness only: the process is up. A load balancer uses this to decide whether to restart it. */
    live: () => ({ status: "alive", uptimeSeconds: Math.round(process.uptime()) }),

    /** Readiness: can it serve traffic? The database is required. Redis and storage only degrade some features. */
    async ready() {
      const [database, cacheStore] = await Promise.all([timed(() => prisma.$queryRaw`SELECT 1`), redis ? timed(() => redis.ping()) : Promise.resolve(null)]);
      return { ready: database.ok, database: database.ok, redis: cacheStore ? cacheStore.ok : null };
    },

    async overview() {
      const since = new Date(Date.now() - DAY);
      const [database, redisCheck, storageCheck, queueRows, workerRows, events, aiOutcomes, jobs, stuck, pendingPayments, overdueRecordings, overdueReports] = await Promise.all([
        timed(() => prisma.$queryRaw`SELECT 1`),
        redis ? timed(() => redis.ping()) : Promise.resolve(null),
        storage.check ? timed(() => storage.check!()) : Promise.resolve(null),
        queueStats(),
        workers().catch(() => []),
        prisma.operationalEvent.groupBy({ by: ["source", "code"], where: { bucketStart: { gte: since } }, _sum: { count: true }, _max: { bucketStart: true } }),
        prisma.aIUsageLog.groupBy({ by: ["outcome"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.aIAssessmentJob.groupBy({ by: ["status"], where: { queuedAt: { gte: since } }, _count: { _all: true } }),
        prisma.aIAssessmentJob.count({ where: { status: { in: ["PENDING", "PROCESSING"] }, queuedAt: { lt: new Date(Date.now() - 3_600_000) } } }),
        prisma.paymentTransaction.count({ where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - 2 * 3_600_000) } } }),
        prisma.speakingSubmission.count({ where: { audioStorageKey: { not: null }, audioDeleteAfter: { lt: new Date(Date.now() - DAY) } } }),
        prisma.generatedReport.count({ where: { storageKey: { not: null }, expiresAt: { lt: new Date(Date.now() - DAY) } } }),
      ]);
      return {
        generatedAt: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        checks: { database, redis: redisCheck, storage: { kind: storage.kind, ...(storageCheck ?? { ok: storage.kind === "local", latencyMs: null }) } },
        queues: queueRows,
        workers: workerRows,
        events: events.map((row) => ({ source: row.source, code: row.code, count: row._sum.count ?? 0, lastSeen: row._max.bucketStart })).sort((a, b) => b.count - a.count),
        ai: { outcomes: Object.fromEntries(aiOutcomes.map((row) => [row.outcome, row._count._all])), jobs: Object.fromEntries(jobs.map((row) => [row.status, row._count._all])), stuckJobs: stuck },
        backlog: { pendingPayments, overdueRecordings, overdueReports },
        cache: cache.stats(),
      };
    },

    close: async () => {
      await Promise.all(queues.map((queue) => queue.close()));
    },
  };
}

export type OperationsService = ReturnType<typeof createOperationsService>;
