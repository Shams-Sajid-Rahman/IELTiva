// The background worker: npm run worker. It handles AI assessment, transcription, audio checks, reports, email and scheduled upkeep.
import { hostname } from "node:os";
import { Queue, UnrecoverableError, Worker, type Job, type Processor } from "bullmq";
import { createPrismaClient } from "./config/database.js";
import { loadConfig } from "./config/env.js";
import { createAiRuntime } from "./services/ai/runtime.js";
import { AiError } from "./services/ai/provider.js";
import { AI_QUEUE, redisConnection, type AiJobData, type AiQueue } from "./services/ai/queue.js";
import { createLearningService } from "./services/analytics/learning.service.js";
import { createStudentAnalyticsService } from "./services/analytics/student.service.js";
import { AudioError, probeAudio } from "./services/audio/audio.service.js";
import { createBillingRuntime } from "./services/billing/runtime.js";
import { createCache } from "./services/cache.js";
import { createEmailProvider } from "./services/email/index.js";
import { createNotifier } from "./services/notifier.js";
import { createNotificationService } from "./services/notification.service.js";
import { createEventRecorder } from "./services/ops/events.js";
import { createPrivacyService } from "./services/privacy/privacy.service.js";
import { createJobQueues, createRedisClient, HEARTBEAT_PREFIX, HEARTBEAT_SECONDS, QUEUES, type JobData } from "./services/queue/jobs.js";
import { createReportService } from "./services/reports/report.service.js";
import { createStorage, withErrorTracking } from "./services/storage/index.js";
import { withCorrelationId } from "./utils/context.js";
import { createLogger } from "./utils/logger.js";

const SHUTDOWN_TIMEOUT_MS = 30_000;
const DAY = 86_400_000;

const env = loadConfig();
const logger = createLogger(env.LOG_LEVEL);
if (!env.REDIS_URL) throw new Error("Set REDIS_URL to run the worker.");

const prisma = createPrismaClient(env.DATABASE_URL);
const events = createEventRecorder(prisma, logger);
const storage = withErrorTracking(createStorage(env), (code, name) => events.record("storage", code, name));
const connection = redisConnection(env.REDIS_URL, { forWorker: true });
const aiQueue = new Queue(AI_QUEUE, { connection });
const maintenanceQueue = new Queue(QUEUES.maintenance, { connection });
const queues = createJobQueues(env.REDIS_URL, logger);
const redis = createRedisClient(env.REDIS_URL, logger);
const email = createEmailProvider(env, logger);
const cache = createCache({ maxEntries: 0 });

const queue: AiQueue = {
  add: async (name, data, id) => {
    await aiQueue.add(name, data, { jobId: id });
  },
  close: () => aiQueue.close(),
};

const notifications = createNotificationService(prisma);
const notify = createNotifier(notifications, queues);
const { ai, assessment, calibration } = createAiRuntime({ prisma, env, storage, logger, queue });
const billing = createBillingRuntime({ prisma, env, logger, notify });
const analytics = createStudentAnalyticsService(prisma, cache);
const learning = createLearningService({ prisma, analytics, ai, notify });
// Sessions are revoked directly here, because the worker has no sign-in service of its own.
const privacy = createPrivacyService({
  prisma,
  storage,
  logger,
  auth: {
    revokeAllSessions: async (userId) => {
      await prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    },
  },
});
const reports = createReportService({ prisma, storage, queues, analytics, buildExport: privacy.buildExport, logger });

/** Permanent failures stop now instead of being retried, and each failure is recorded where students can see it. */
function classify(error: unknown) {
  const failure = error instanceof AiError ? error : new AiError("PROVIDER_ERROR", "Processing failed.", true);
  return { code: failure.code, message: failure.message, retryable: failure.retryable };
}

async function runAssessment(job: Job<AiJobData>) {
  const row = await assessment.markRunning(job.data.jobId);
  // Finished already: a duplicate delivery does nothing and costs nothing.
  if (!row) return;
  try {
    if (row.subjectType === "writing_submission") await assessment.runWriting(row.id, row.subjectId, row.userId);
    else if (row.subjectType === "speaking_submission") await assessment.runSpeaking(row.id, row.subjectId, row.userId);
    else throw new AiError("BAD_REQUEST", "Unknown job type.", false);
  } catch (error) {
    const failure = classify(error);
    const final = !failure.retryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    logger.warn({ jobId: row.id, task: row.taskKey, code: failure.code, final }, "AI job failed");
    events.record("ai", failure.code);
    if (final) await assessment.markFailed(row.id, failure);
    if (!failure.retryable) throw new UnrecoverableError(failure.code);
    throw error;
  }
}

async function runCalibration(job: Job<AiJobData>) {
  try {
    await calibration.executeRun(job.data.jobId);
  } catch (error) {
    const failure = classify(error);
    const final = !failure.retryable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    events.record("ai", failure.code);
    if (final) await calibration.failRun(job.data.jobId, failure.message);
    if (!failure.retryable) throw new UnrecoverableError(failure.code);
    throw error;
  }
}

/** Checks a saved recording really is audio, and records its true length. A broken file is removed so the student can record again. */
async function processRecording(job: Job<JobData["audio.process-recording"]>) {
  const row = await prisma.speakingSubmission.findUnique({ where: { id: job.data.submissionId }, select: { id: true, audioStorageKey: true } });
  if (!row?.audioStorageKey) return;
  const data = await storage.get(row.audioStorageKey);
  if (!data) return;
  try {
    const info = await probeAudio(data);
    if (info.durationSeconds > 0) await prisma.speakingSubmission.updateMany({ where: { id: row.id, audioStorageKey: row.audioStorageKey }, data: { durationSeconds: info.durationSeconds } });
  } catch (error) {
    if (error instanceof AudioError && error.kind === "INVALID") {
      await storage.delete(row.audioStorageKey);
      await prisma.speakingSubmission.updateMany({ where: { id: row.id, audioStorageKey: row.audioStorageKey }, data: { audioStorageKey: null, status: "FAILED" } });
      events.record("audio", "invalid_recording");
      return;
    }
    events.record("audio", "probe_unavailable");
    throw error;
  }
}

async function sendNotificationEmail(job: Job<JobData["email.notification"]>) {
  const user = await prisma.user.findFirst({ where: { id: job.data.userId, status: "ACTIVE", deletedAt: null }, select: { email: true } });
  if (!user) return;
  const link = job.data.link ? `\n\n${env.FRONTEND_URL}${job.data.link}` : "";
  try {
    await email.send({ to: user.email, subject: job.data.title, text: `${job.data.body}${link}` });
  } catch (error) {
    events.record("email", "send_failed");
    throw error;
  }
}

/** Removes anything past its time. Each task can safely repeat, and one failing doesn't stop the others next time. */
const maintenance: Record<string, () => Promise<unknown>> = {
  "retention.recordings": () => assessment.deleteExpiredRecordings(),
  "retention.reports": () => reports.deleteExpired(),
  "retention.operations": async () => {
    await prisma.operationalEvent.deleteMany({ where: { bucketStart: { lt: new Date(Date.now() - 30 * DAY) } } });
    await prisma.paymentWebhookEvent.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - 90 * DAY) } } });
  },
  "retention.tokens": async () => {
    const setting = await prisma.platformSetting.findUnique({ where: { key: "retention.expired_tokens_days" } });
    const cutoff = new Date(Date.now() - (typeof setting?.value === "number" ? setting.value : 7) * DAY);
    await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    await prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    await prisma.userSession.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  },
  // Addresses help investigate recent problems. After that they're only personal data, so they're cleared and the record of what happened stays.
  "retention.audit_addresses": async () => {
    const setting = await prisma.platformSetting.findUnique({ where: { key: "retention.audit_ip_days" } });
    await prisma.auditLog.updateMany({ where: { ipAddress: { not: null }, createdAt: { lt: new Date(Date.now() - (typeof setting?.value === "number" ? setting.value : 365) * DAY) } }, data: { ipAddress: null } });
  },
  "billing.sweep": () => billing.payments.sweepPending(),
  "billing.expire": () => billing.entitlements.expireDue(),
  "reminders.tick": () => learning.sendDueReminders(),
  "privacy.deletions": () => privacy.processDueDeletions(),
};

const SCHEDULE: Record<keyof typeof maintenance, number> = {
  "retention.recordings": 3_600_000,
  "retention.reports": 3_600_000,
  "retention.operations": DAY,
  "retention.tokens": DAY,
  "retention.audit_addresses": DAY,
  "billing.sweep": 300_000,
  "billing.expire": 3_600_000,
  "reminders.tick": 900_000,
  "privacy.deletions": 3_600_000,
};

/** Every job's log lines carry one ID, and any uncaught failure is counted for the operations page. */
function tracked<T>(source: "worker", processor: Processor<T>): Processor<T> {
  return (job, token) => {
    const correlationId = (job.data as { correlationId?: string | null }).correlationId ?? `job-${job.queueName}-${job.id}`;
    return withCorrelationId(correlationId, async () => {
      const started = Date.now();
      try {
        const result = await processor(job, token);
        logger.debug({ queue: job.queueName, name: job.name, ms: Date.now() - started }, "Job finished");
        return result;
      } catch (error) {
        events.record(source, `${job.queueName}:${job.name}`.slice(0, 80));
        logger.warn({ queue: job.queueName, name: job.name, attempt: job.attemptsMade + 1 }, "Job failed");
        throw error;
      }
    });
  };
}

const workers = [
  new Worker<AiJobData>(
    AI_QUEUE,
    tracked("worker", async (job) => {
      if (job.name === "calibration.run") return runCalibration(job);
      return runAssessment(job);
    }),
    // Calibration runs can be long. BullMQ keeps renewing the lock while a job is alive.
    { connection, concurrency: 3, lockDuration: 120_000 },
  ),
  new Worker<JobData["audio.process-recording"]>(QUEUES.audio, tracked("worker", processRecording), { connection, concurrency: 2, lockDuration: 150_000 }),
  new Worker<JobData["report.generate"]>(
    QUEUES.reports,
    tracked("worker", async (job) => {
      try {
        await reports.generate(job.data.reportId);
      } catch (error) {
        if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await reports.markFailed(job.data.reportId);
        throw error;
      }
    }),
    { connection, concurrency: 2 },
  ),
  new Worker<JobData["email.notification"]>(QUEUES.email, tracked("worker", sendNotificationEmail), { connection, concurrency: 5 }),
  new Worker(
    QUEUES.maintenance,
    tracked("worker", async (job) => {
      const task = maintenance[job.name];
      if (!task) return;
      const result = await task();
      if (typeof result === "number" && result > 0) logger.info({ task: job.name, count: result }, "Maintenance task did work");
    }),
    { connection, concurrency: 1, lockDuration: 300_000 },
  ),
];

for (const worker of workers) worker.on("error", (error) => logger.error({ err: error, queue: worker.name }, "Worker error"));

// Retention used to run on the AI queue, so that older schedule is removed if it's still there.
await aiQueue.removeJobScheduler("retention.recordings").catch(() => undefined);
for (const [name, every] of Object.entries(SCHEDULE)) {
  await maintenanceQueue.upsertJobScheduler(name, { every }, { name, data: {}, opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 100 }, attempts: 1 } });
}

// A heartbeat that expires by itself, so the operations page can tell when a worker has gone away.
const beatKey = `${HEARTBEAT_PREFIX}${hostname()}:${process.pid}`;
const startedAt = new Date().toISOString();
const beat = () => redis?.set(beatKey, JSON.stringify({ host: hostname(), pid: process.pid, startedAt, beatAt: new Date().toISOString() }), "EX", HEARTBEAT_SECONDS * 3).catch(() => undefined);
void beat();
const heartbeat = setInterval(() => void beat(), HEARTBEAT_SECONDS * 1000);

logger.info({ queues: workers.map((worker) => worker.name) }, "Worker running");

let stopping = false;
/** Stops taking new jobs, waits for running ones to finish, then closes connections. A stuck job can't hold shutdown open for ever. */
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Worker shutting down");
  const forced = setTimeout(() => {
    logger.error("Worker shutdown timed out");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forced.unref();
  clearInterval(heartbeat);
  try {
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await redis?.del(beatKey).catch(() => undefined);
    await Promise.allSettled([aiQueue.close(), maintenanceQueue.close(), queues?.close(), redis?.quit()]);
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Worker shutdown failed");
    process.exit(1);
  }
}
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
