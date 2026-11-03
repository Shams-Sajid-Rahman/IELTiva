import { Prisma } from "../generated/prisma/client.js";
import type { Actor, Db } from "../types/platform.js";

const SENSITIVE_KEY = /password|token|secret|hash|cookie|authorization/i;

/** Removes anything credential-like, so audit history can't leak secrets even if a caller passes them. */
export function sanitizeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, item]) => [key, sanitizeAuditValue(item)]),
    );
  }
  return value;
}

type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
};

export function recordAudit(db: Db, actor: Pick<Actor, "userId" | "ipAddress"> | null, entry: AuditEntry) {
  const json = (value: unknown) =>
    value === undefined ? Prisma.JsonNull : (sanitizeAuditValue(value) as Prisma.InputJsonValue);
  return db.auditLog.create({
    data: {
      actorId: actor?.userId ?? null,
      ipAddress: actor?.ipAddress ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: json(entry.before),
      after: json(entry.after),
    },
  });
}
