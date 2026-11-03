import type { Prisma, PrismaClient, UserStatus } from "../generated/prisma/client.js";
import type { Actor } from "../types/platform.js";
import { pageMeta } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";
import { recordAudit } from "./audit.service.js";
import type { NotificationService } from "./notification.service.js";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

// An explicit list, so password hashes and tokens can never be returned by accident.
const userSummary = {
  id: true,
  email: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  profile: { select: { firstName: true, lastName: true } },
  userRoles: { select: { role: { select: { code: true, name: true } } } },
} satisfies Prisma.UserSelect;

type SummaryRow = Prisma.UserGetPayload<{ select: typeof userSummary }>;

function present(row: SummaryRow) {
  const { profile, userRoles, emailVerifiedAt, ...rest } = row;
  return {
    ...rest,
    firstName: profile?.firstName ?? "",
    lastName: profile?.lastName ?? "",
    emailVerified: emailVerifiedAt !== null,
    roles: userRoles.map(({ role }) => role.code),
  };
}

export async function permissionsOfUser(prisma: PrismaClient, userId: string) {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    select: { role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } } },
  });
  return {
    roles: roles.map(({ role }) => role.code),
    permissions: [...new Set(roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code)))],
  };
}

/** An administrator can only act on people whose authority doesn't exceed their own. */
export async function assertCanActOn(prisma: PrismaClient, actor: Actor, targetId: string) {
  const target = await permissionsOfUser(prisma, targetId);
  if (target.permissions.some((permission) => !actor.permissions.includes(permission))) {
    throw new AppError(403, "FORBIDDEN", "This account has more authority than yours.");
  }
  return target;
}

type ListQuery = { page: number; pageSize: number; search?: string | undefined; role?: string | undefined; status?: UserStatus | undefined; sort: string };

export function createUserAdminService(prisma: PrismaClient, notifications: NotificationService, revokeAllSessions: (userId: string) => Promise<void>) {
  async function findUser(id: string) {
    const row = await prisma.user.findUnique({ where: { id }, select: userSummary });
    if (!row) throw new AppError(404, "NOT_FOUND", "User not found.");
    return row;
  }

  return {
    async list(query: ListQuery) {
      const search = query.search;
      const where: Prisma.UserWhereInput = {
        ...(query.status ? { status: query.status } : { status: { not: "DELETED" } }),
        ...(query.role ? { userRoles: { some: { role: { code: query.role } } } } : {}),
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: "insensitive" as const } },
                { profile: { firstName: { contains: search, mode: "insensitive" as const } } },
                { profile: { lastName: { contains: search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      };
      const descending = query.sort.startsWith("-");
      const field = query.sort.replace("-", "");
      const orderBy: Prisma.UserOrderByWithRelationInput =
        field === "lastLoginAt" ? { lastLoginAt: { sort: descending ? "desc" : "asc", nulls: "last" } } : { [field]: descending ? "desc" : "asc" };
      const [rows, total] = await prisma.$transaction([
        prisma.user.findMany({ where, select: userSummary, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        prisma.user.count({ where }),
      ]);
      return { items: rows.map(present), meta: pageMeta(query.page, query.pageSize, total) };
    },

    async get(id: string) {
      const row = await findUser(id);
      const [enrollments, completedResources, loggedMinutes, lastActivity] = await Promise.all([
        prisma.userEnrollment.findMany({
          where: { userId: id },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, status: true, createdAt: true, completedAt: true, course: { select: { id: true, title: true } } },
        }),
        prisma.learningProgress.count({ where: { userId: id, status: "COMPLETED" } }),
        prisma.userLearningHistory.aggregate({ where: { userId: id }, _sum: { minutes: true } }),
        prisma.userLearningHistory.findFirst({ where: { userId: id }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
      ]);
      return {
        ...present(row),
        enrollments,
        learning: { completedResources, loggedMinutes: loggedMinutes._sum.minutes ?? 0, lastActivityAt: lastActivity?.occurredAt ?? null },
      };
    },

    async update(actor: Actor, id: string, input: { firstName?: string | undefined; lastName?: string | undefined }) {
      const before = await findUser(id);
      if (id !== actor.userId) await assertCanActOn(prisma, actor, id);
      await prisma.$transaction(async (tx) => {
        await tx.userProfile.upsert({
          where: { userId: id },
          create: { userId: id, firstName: input.firstName ?? "", lastName: input.lastName ?? "" },
          update: input,
        });
        await recordAudit(tx, actor, {
          action: "user.update",
          entityType: "User",
          entityId: id,
          before: { firstName: before.profile?.firstName, lastName: before.profile?.lastName },
          after: input,
        });
      });
      return present(await findUser(id));
    },

    async setStatus(actor: Actor, id: string, status: "ACTIVE" | "SUSPENDED", reason?: string) {
      if (id === actor.userId) throw new AppError(409, "CONFLICT", "You can't change your own account status.");
      const before = await findUser(id);
      await assertCanActOn(prisma, actor, id);
      if (before.status === "DELETED") throw new AppError(409, "CONFLICT", "This account has been deleted.");
      if (status === "SUSPENDED") {
        const isAdmin = before.userRoles.some(({ role }) => ADMIN_ROLES.includes(role.code));
        if (isAdmin) {
          const remaining = await prisma.user.count({
            where: { id: { not: id }, status: "ACTIVE", userRoles: { some: { role: { code: "SUPER_ADMIN" } } } },
          });
          if (remaining === 0) throw new AppError(409, "CONFLICT", "This would leave no active super administrator.");
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { status } });
        await recordAudit(tx, actor, { action: "user.status", entityType: "User", entityId: id, before: { status: before.status }, after: { status, reason } });
      });
      if (status === "SUSPENDED") await revokeAllSessions(id);
      await notifications.notifyUser(id, {
        type: "SECURITY",
        title: status === "SUSPENDED" ? "Account suspended" : "Account restored",
        body: status === "SUSPENDED" ? "An administrator suspended your account." : "An administrator restored your account.",
      });
      return present(await findUser(id));
    },

    /** Shows learning records, plus administrative actions only to people allowed to read the audit log. */
    async activity(actor: Actor, id: string, query: { page: number; pageSize: number }) {
      await findUser(id);
      const where = { userId: id };
      const [rows, total] = await prisma.$transaction([
        prisma.userLearningHistory.findMany({
          where,
          orderBy: { occurredAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { id: true, eventType: true, minutes: true, occurredAt: true, course: { select: { title: true } }, resource: { select: { title: true } } },
        }),
        prisma.userLearningHistory.count({ where }),
      ]);
      const auditEntries = actor.permissions.includes("audit.read")
        ? await prisma.auditLog.findMany({
            where: { entityType: "User", entityId: id },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { id: true, action: true, createdAt: true, actor: { select: { email: true } } },
          })
        : [];
      return { learning: { items: rows, meta: pageMeta(query.page, query.pageSize, total) }, auditEntries };
    },
  };
}

export type UserAdminService = ReturnType<typeof createUserAdminService>;
