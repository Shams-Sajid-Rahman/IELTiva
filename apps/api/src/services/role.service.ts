import type { PrismaClient } from "../generated/prisma/client.js";
import type { Actor } from "../types/platform.js";
import { AppError } from "../utils/app-error.js";
import { recordAudit } from "./audit.service.js";
import type { NotificationService } from "./notification.service.js";
import { assertCanActOn } from "./user-admin.service.js";

/** Only the Super administrator role may hold these. */
export const CRITICAL_PERMISSIONS = ["roles.manage", "settings.manage", "ai.configure", "ai.band_release"];
const ADMIN_ROLE_CODES = ["ADMIN", "SUPER_ADMIN"];
/** Students can never be given more than ordinary learner access. */
const STUDENT_ALLOWED = ["content.read", "attempts.own"];

const roleSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: { select: { permission: { select: { code: true, description: true } } } },
  _count: { select: { userRoles: true } },
} as const;

type RoleRow = { id: string; code: string; name: string; description: string | null; isSystem: boolean; permissions: { permission: { code: string; description: string | null } }[]; _count: { userRoles: number } };

function present({ permissions, _count, ...role }: RoleRow) {
  return { ...role, userCount: _count.userRoles, permissions: permissions.map(({ permission }) => permission.code).sort(), locked: role.code === "SUPER_ADMIN" };
}

const GROUP_LABELS: Record<string, string> = {
  users: "User management",
  roles: "Role management",
  courses: "Course management",
  content: "Content",
  modules: "Learning module management",
  enrollments: "Enrollment management",
  notifications: "Notification management",
  audit: "Audit log access",
  settings: "Platform settings",
  dashboard: "Administration overview",
  attempts: "Attempts",
  assessments: "Assessments",
  calibration: "Calibration",
  payments: "Payments",
  ai: "AI configuration",
};

export function createRoleService(prisma: PrismaClient, notifications: NotificationService) {
  return {
    async list() {
      const rows = await prisma.role.findMany({ select: roleSelect, orderBy: { code: "asc" } });
      return rows.map(present);
    },

    async get(id: string) {
      const row = await prisma.role.findUnique({ where: { id }, select: roleSelect });
      if (!row) throw new AppError(404, "NOT_FOUND", "Role not found.");
      return present(row);
    },

    async listPermissions() {
      const rows = await prisma.permission.findMany({ orderBy: { code: "asc" }, select: { code: true, description: true } });
      const groups = new Map<string, { key: string; label: string; permissions: { code: string; description: string | null; critical: boolean }[] }>();
      for (const row of rows) {
        const key = row.code.split(".")[0]!;
        if (!groups.has(key)) groups.set(key, { key, label: GROUP_LABELS[key] ?? key, permissions: [] });
        groups.get(key)!.permissions.push({ ...row, critical: CRITICAL_PERMISSIONS.includes(row.code) });
      }
      return [...groups.values()];
    },

    async setRolePermissions(actor: Actor, id: string, codes: string[]) {
      const role = await prisma.role.findUnique({ where: { id }, select: roleSelect });
      if (!role) throw new AppError(404, "NOT_FOUND", "Role not found.");
      if (role.code === "SUPER_ADMIN") throw new AppError(409, "CONFLICT", "The Super administrator role can't be changed.");
      const requested = [...new Set(codes)];
      const current = role.permissions.map(({ permission }) => permission.code);
      const known = await prisma.permission.findMany({ where: { code: { in: requested } }, select: { id: true, code: true } });
      if (known.length !== requested.length) throw new AppError(400, "VALIDATION_ERROR", "One of those permissions doesn't exist.");
      if (requested.some((code) => CRITICAL_PERMISSIONS.includes(code))) throw new AppError(403, "FORBIDDEN", "System-critical permissions stay with the Super administrator role.");
      if (role.code === "STUDENT" && requested.some((code) => !STUDENT_ALLOWED.includes(code))) throw new AppError(403, "FORBIDDEN", "Students can only have learner permissions.");
      // Nobody can hand out, or take away, authority they don't hold.
      const changed = [...requested.filter((code) => !current.includes(code)), ...current.filter((code) => !requested.includes(code))];
      if (changed.some((code) => !actor.permissions.includes(code))) throw new AppError(403, "FORBIDDEN", "You can't change permissions you don't hold.");

      await prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({ data: known.map((permission) => ({ roleId: id, permissionId: permission.id })) });
        await recordAudit(tx, actor, { action: "role.permissions", entityType: "Role", entityId: id, before: { code: role.code, permissions: current }, after: { code: role.code, permissions: requested } });
      });
      return present((await prisma.role.findUnique({ where: { id }, select: roleSelect }))!);
    },

    async setUserRoles(actor: Actor, userId: string, codes: string[]) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
      if (!user) throw new AppError(404, "NOT_FOUND", "User not found.");
      const target = await prisma.userRole.findMany({ where: { userId }, select: { role: { select: { code: true } } } });
      const current = target.map(({ role }) => role.code);
      const requested = [...new Set(codes)];
      const added = requested.filter((code) => !current.includes(code));
      const removed = current.filter((code) => !requested.includes(code));
      if (added.length === 0 && removed.length === 0) return { roles: current };

      const self = userId === actor.userId;
      if (self && added.length) throw new AppError(403, "FORBIDDEN", "You can't give yourself a role.");
      if (self && removed.some((code) => ADMIN_ROLE_CODES.includes(code)) && !requested.some((code) => ADMIN_ROLE_CODES.includes(code))) {
        throw new AppError(409, "CONFLICT", "You can't remove your own administrative access.");
      }
      if (!self) await assertCanActOn(prisma, actor, userId);

      const roles = await prisma.role.findMany({ where: { code: { in: [...added, ...removed, ...requested] } }, select: { id: true, code: true, permissions: { select: { permission: { select: { code: true } } } } } });
      const byCode = new Map(roles.map((role) => [role.code, role]));
      for (const code of [...added, ...removed]) {
        const role = byCode.get(code);
        if (!role) throw new AppError(400, "VALIDATION_ERROR", `The role ${code} doesn't exist.`);
        if (role.permissions.some(({ permission }) => !actor.permissions.includes(permission.code))) {
          throw new AppError(403, "FORBIDDEN", `You can't assign or remove the ${code} role, because it has more authority than yours.`);
        }
      }
      if (removed.includes("SUPER_ADMIN")) {
        const others = await prisma.user.count({ where: { id: { not: userId }, status: "ACTIVE", userRoles: { some: { role: { code: "SUPER_ADMIN" } } } } });
        if (others === 0) throw new AppError(409, "CONFLICT", "This would leave no active super administrator.");
      }
      await prisma.$transaction(async (tx) => {
        await tx.userRole.deleteMany({ where: { userId, role: { code: { in: removed } } } });
        await tx.userRole.createMany({ data: added.map((code) => ({ userId, roleId: byCode.get(code)!.id, assignedById: actor.userId })) });
        await recordAudit(tx, actor, { action: "user.roles", entityType: "User", entityId: userId, before: { roles: current }, after: { roles: requested } });
      });
      await notifications.notifyUser(userId, { type: "SECURITY", title: "Your access changed", body: `An administrator updated your roles to: ${requested.join(", ")}.` });
      return { roles: requested };
    },
  };
}

export type RoleService = ReturnType<typeof createRoleService>;
