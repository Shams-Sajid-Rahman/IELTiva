import { Queue } from "bullmq";
import type { Logger } from "../../utils/logger.js";

export const AI_QUEUE = "ieltiva-ai";
export const JOB_OPTIONS = { attempts: 3, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: { age: 86_400 }, removeOnFail: { age: 604_800 } } as const;

export type AiJobName = "writing.assess" | "speaking.assess" | "calibration.run";
export type AiJobData = { jobId: string };

export function redisConnection(url: string, options: { forWorker: boolean }) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
    // A worker waits out a Redis restart. The API fails fast, so a request isn't left hanging.
    maxRetriesPerRequest: options.forWorker ? null : 1,
    enableOfflineQueue: options.forWorker,
  };
}

export type AiQueue = { add: (name: AiJobName, data: AiJobData, id: string) => Promise<void>; close: () => Promise<void> };

/** Returns null without Redis, and features then report that AI processing isn't available. */
export function createAiQueue(url: string | undefined, logger: Pick<Logger, "warn">): AiQueue | null {
  if (!url) return null;
  const queue = new Queue(AI_QUEUE, { connection: redisConnection(url, { forWorker: false }) });
  let warned = false;
  queue.on("error", () => {
    if (!warned) logger.warn("Can't reach Redis, so AI jobs can't be queued");
    warned = true;
  });
  return {
    // The job's own ID makes a repeated request collapse into one queued job.
    add: async (name, data, id) => {
      await queue.add(name, data, { ...JOB_OPTIONS, jobId: id });
    },
    close: () => queue.close(),
  };
}
