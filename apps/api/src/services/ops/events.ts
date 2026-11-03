import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Logger } from "../../utils/logger.js";

export type EventSource = "storage" | "ai" | "payment" | "email" | "worker" | "audio";

const MINUTE = 60_000;

/**
 * Counts operational errors by minute. It must never be able to break the work it's reporting on, so any failure here
 * is only logged. Callers pass short codes, never a student's details or a raw provider message.
 */
export function createEventRecorder(prisma: PrismaClient, logger: Pick<Logger, "warn">) {
  return {
    record(source: EventSource, code: string, message?: string) {
      const bucket = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
      const text = message?.slice(0, 200) ?? null;
      void prisma.$executeRaw`
        INSERT INTO operational_events (id, source, code, message, count, bucket_start, updated_at)
        VALUES (gen_random_uuid(), ${source}, ${code.slice(0, 80)}, ${text}, 1, ${bucket}, now())
        ON CONFLICT (source, code, bucket_start) DO UPDATE SET count = operational_events.count + 1, updated_at = now()`.catch(() => {
        logger.warn({ source, code }, "Couldn't record an operational event");
      });
    },
  };
}

export type EventRecorder = ReturnType<typeof createEventRecorder>;
