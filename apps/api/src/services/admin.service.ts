import { z } from "zod";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { Actor } from "../types/platform.js";
import { pageMeta } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";
import { recordAudit } from "./audit.service.js";

const days = z.number().int().min(1).max(3650);

const SETTING_RULES: Record<string, z.ZodType> = {
  "retention.speaking_recordings_days": days,
  "retention.expired_tokens_days": days,
  "retention.data_exports_days": days,
  "retention.audit_ip_days": days,
  "privacy.deletion_cancel_window_days": days,
  "billing.enforce_credits": z.boolean(),
  "billing.refund_window_days": z.number().int().min(0).max(365),
  "regions.default": z.string().regex(/^[A-Z]{2}$/),
  "regions.bd": z.strictObject({ currency: z.string().regex(/^[A-Z]{3}$/), locale: z.string().min(2).max(10), gateways: z.array(z.string().min(1)).max(10) }),
};

type AuditQuery = { page: number; pageSize: number; action?: string | undefined; entityType?: string | undefined; actorId?: string | undefined; from?: string | undefined; to?: string | undefined };

export function createAdminService(prisma: PrismaClient) {
  return {
    /** Read-only. Audit records have no update or delete endpoint, and a database trigger blocks those writes. */
    async auditLogs(query: AuditQuery) {
      const where: Prisma.AuditLogWhereInput = {
        ...(query.action ? { action: { contains: query.action, mode: "insensitive" as const } } : {}),
        ...(query.entityType ? { entityType: { contains: query.entityType, mode: "insensitive" as const } } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
                ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { id: true, action: true, entityType: true, entityId: true, before: true, after: true, createdAt: true, actor: { select: { id: true, email: true } } },
        }),
        prisma.auditLog.count({ where }),
      ]);
      return { items: rows, meta: pageMeta(query.page, query.pageSize, total) };
    },

    async settings() {
      const rows = await prisma.platformSetting.findMany({ where: { key: { not: { startsWith: "seed." } } }, orderBy: { key: "asc" }, select: { key: true, value: true, description: true, updatedAt: true } });
      return rows.map((row) => ({ ...row, editable: row.key in SETTING_RULES }));
    },

    async updateSetting(actor: Actor, key: string, value: unknown) {
      const rule = SETTING_RULES[key];
      if (!rule) throw new AppError(404, "NOT_FOUND", "That setting can't be changed.");
      const parsed = rule.parse(value) as Prisma.InputJsonValue;
      const before = await prisma.platformSetting.findUnique({ where: { key } });
      if (!before) throw new AppError(404, "NOT_FOUND", "That setting doesn't exist.");
      return prisma.$transaction(async (tx) => {
        const row = await tx.platformSetting.update({ where: { key }, data: { value: parsed }, select: { key: true, value: true, description: true, updatedAt: true } });
        await recordAudit(tx, actor, { action: "setting.update", entityType: "PlatformSetting", entityId: key, before: { value: before.value }, after: { value: parsed } });
        return row;
      });
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
