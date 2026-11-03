import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { redisConnection } from "../ai/queue.js";
import type { SharedStore } from "../cache.js";
import { currentCorrelationId } from "../../utils/context.js";
import type { Logger } from "../../utils/logger.js";

/** Background work outside AI. Each kind has its own queue, so a slow report can't hold up a student's feedback. */
export const QUEUES = {
  audio: "ieltiva-audio",
  reports: "ieltiva-reports",
  email: "ieltiva-email",
  maintenance: "ieltiva-maintenance",
} as const;

export const ALL_QUEUE_NAMES = ["ieltiva-ai", ...Object.values(QUEUES)];

export type JobData = {
  "audio.process-recording": { submissionId: string };
  "report.generate": { reportId: string };
  /** Carries no address. The worker looks the student up when it sends, so emails never sit in Redis. */
  "email.notification": { userId: string; title: string; body: string; link: string | null };
};
export type JobName = keyof JobData;

const QUEUE_OF: Record<JobName, string> = {
  "audio.process-recording": QUEUES.audio,
  "report.generate": QUEUES.reports,
  "email.notification": QUEUES.email,
};

const JOB_OPTIONS = { attempts: 4, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { age: 86_400, count: 5_000 }, removeOnFail: { age: 1_209_600 } } as const;

export type JobQueues = {
  add: <N extends JobName>(name: N, data: JobData[N], id: string) => Promise<void>;
  close: () => Promise<void>;
};

/** Returns null without Redis, and each feature then does the work directly or reports that it's unavailable. */
export function createJobQueues(url: string | undefined, logger: Pick<Logger, "warn">): JobQueues | null {
  if (!url) return null;
  const connection = redisConnection(url, { forWorker: false });
  const queues = new Map(Object.values(QUEUES).map((name) => [name, new Queue(name, { connection })]));
  let warned = false;
  for (const queue of queues.values()) {
    queue.on("error", () => {
      if (!warned) logger.warn("Can't reach Redis, so background jobs can't be queued");
      warned = true;
    });
  }
  return {
    // The job's own ID makes a repeat collapse into one job, and the correlation ID follows the work into the worker's logs.
    add: async (name, data, id) => {
      const queue = queues.get(QUEUE_OF[name] as (typeof QUEUES)[keyof typeof QUEUES]);
      await queue!.add(name, { ...data, correlationId: currentCorrelationId() ?? null }, { ...JOB_OPTIONS, jobId: id.replace(/:/g, "_") });
    },
    close: async () => {
      await Promise.all([...queues.values()].map((queue) => queue.close()));
    },
  };
}

/** A plain Redis client for health checks, the shared cache and worker heartbeats. */
export function createRedisClient(url: string | undefined, logger: Pick<Logger, "warn">) {
  if (!url) return null;
  const client = new Redis({ ...redisConnection(url, { forWorker: false }), lazyConnect: false });
  let warned = false;
  client.on("error", () => {
    if (!warned) logger.warn("Can't reach Redis");
    warned = true;
  });
  client.on("ready", () => {
    warned = false;
  });
  return client;
}

const CACHE_PREFIX = "ieltiva:cache:";

export function createRedisStore(client: Redis): SharedStore {
  return {
    get: (key) => client.get(CACHE_PREFIX + key),
    set: async (key, value, ttlSeconds) => {
      await client.set(CACHE_PREFIX + key, value, "EX", ttlSeconds);
    },
    deletePrefix: async (prefix) => {
      // SCAN rather than KEYS, so clearing entries can't stall Redis for other work.
      let cursor = "0";
      do {
        const [next, keys] = await client.scan(cursor, "MATCH", `${CACHE_PREFIX}${prefix}*`, "COUNT", 200);
        cursor = next;
        if (keys.length) await client.del(...keys);
      } while (cursor !== "0");
    },
  };
}

export const HEARTBEAT_PREFIX = "ieltiva:worker:";
export const HEARTBEAT_SECONDS = 20;
