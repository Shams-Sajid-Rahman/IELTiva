import { defaultNotificationPrefs, notificationPrefsSchema, type NotificationPrefs } from "@ieltiva/shared";
import { AnnouncementAudience, NotificationType, Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { Actor } from "../types/platform.js";
import { pageMeta } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";
import { recordAudit } from "./audit.service.js";

type Message = {
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  dedupeKey?: string;
  /** Learning messages respect the user's preference. Security messages always arrive. */
  preference?: keyof NotificationPrefs;
};

export function readNotificationPrefs(value: unknown): NotificationPrefs {
  const parsed = notificationPrefsSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultNotificationPrefs;
}

const notExpired = () => ({ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] });

export function createNotificationService(prisma: PrismaClient) {
  function visibleWhere(userId: string): Prisma.UserNotificationWhereInput {
    return { userId, dismissedAt: null, notification: { status: "PUBLISHED", ...notExpired() } };
  }

  /** Sends one in-app message. A dedupe key makes repeat events harmless. */
  async function notifyUser(userId: string, message: Message) {
    if (message.preference) {
      const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { notificationPrefs: true } });
      if (!readNotificationPrefs(profile?.notificationPrefs)[message.preference]) return;
    }
    const data = { type: message.type, title: message.title, body: message.body, link: message.link ?? null, dedupeKey: message.dedupeKey ?? null };
    try {
      await prisma.notification.create({
        data: { ...data, status: "PUBLISHED", publishedAt: new Date(), recipients: { create: { userId } } },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }

  /** One efficient insert, because there are no background workers in this phase. */
  async function fanOut(notificationId: string, role: string | null, preference: keyof NotificationPrefs) {
    await prisma.$executeRaw`
      INSERT INTO user_notifications (id, user_id, notification_id, updated_at)
      SELECT gen_random_uuid(), u.id, ${notificationId}::uuid, now()
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.status = 'ACTIVE'
        AND COALESCE((p.notification_prefs ->> ${preference})::boolean, true)
        AND (${role}::text IS NULL OR EXISTS (
          SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = ${role}::text
        ))
      ON CONFLICT (user_id, notification_id) DO NOTHING`;
  }

  return {
    notifyUser,

    async notifyCoursePublished(course: { id: string; title: string }) {
      const dedupeKey = `course-published:${course.id}`;
      if (await prisma.notification.count({ where: { dedupeKey } })) return;
      const notification = await prisma.notification.create({
        data: {
          type: "LEARNING",
          title: "New course available",
          body: `"${course.title}" is now available.`,
          link: `/courses/${course.id}`,
          status: "PUBLISHED",
          publishedAt: new Date(),
          dedupeKey,
        },
      });
      await fanOut(notification.id, "STUDENT", "learning");
    },

    async list(userId: string, query: { page: number; pageSize: number; type?: NotificationType | undefined; unread?: "true" | "false" | undefined }) {
      const where: Prisma.UserNotificationWhereInput = {
        ...visibleWhere(userId),
        ...(query.unread === "true" ? { readAt: null } : query.unread === "false" ? { readAt: { not: null } } : {}),
      };
      if (query.type) where.notification = { ...(where.notification as Prisma.NotificationWhereInput), type: query.type };
      const [rows, total] = await prisma.$transaction([
        prisma.userNotification.findMany({
          where,
          include: { notification: { select: { type: true, title: true, body: true, link: true } } },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.userNotification.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({ id: row.id, readAt: row.readAt, createdAt: row.createdAt, ...row.notification })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },

    unreadCount(userId: string) {
      return prisma.userNotification.count({ where: { ...visibleWhere(userId), readAt: null } });
    },

    async markRead(userId: string, id: string) {
      const { count } = await prisma.userNotification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
      if (count === 0 && !(await prisma.userNotification.count({ where: { id, userId } }))) {
        throw new AppError(404, "NOT_FOUND", "Notification not found.");
      }
    },

    async markAllRead(userId: string) {
      const { count } = await prisma.userNotification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
      return count;
    },

    async dismiss(userId: string, id: string) {
      const { count } = await prisma.userNotification.updateMany({ where: { id, userId, dismissedAt: null }, data: { dismissedAt: new Date() } });
      if (count === 0) throw new AppError(404, "NOT_FOUND", "Notification not found.");
    },

    async createAnnouncement(
      actor: Actor,
      input: { title: string; body: string; audience: AnnouncementAudience; audienceRole?: string | undefined; publish: boolean; expiresAt?: string | undefined },
    ) {
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && expiresAt <= new Date()) throw new AppError(400, "VALIDATION_ERROR", "The expiry date must be in the future.");
      const role = input.audience === "ROLE" ? (input.audienceRole ?? null) : null;
      if (role && !(await prisma.role.count({ where: { code: role } }))) throw new AppError(400, "VALIDATION_ERROR", "That role doesn't exist.");
      const notification = await prisma.notification.create({
        data: {
          type: "ANNOUNCEMENT",
          title: input.title,
          body: input.body,
          audience: input.audience,
          audienceRole: role,
          status: input.publish ? "PUBLISHED" : "DRAFT",
          publishedAt: input.publish ? new Date() : null,
          expiresAt,
          createdById: actor.userId,
        },
      });
      if (input.publish) await fanOut(notification.id, role, "announcements");
      await recordAudit(prisma, actor, { action: "announcement.create", entityType: "Notification", entityId: notification.id, after: { title: input.title, audience: input.audience, audienceRole: role, published: input.publish } });
      return notification;
    },

    async publishAnnouncement(actor: Actor, id: string) {
      const notification = await prisma.notification.findFirst({ where: { id, type: "ANNOUNCEMENT" } });
      if (!notification) throw new AppError(404, "NOT_FOUND", "Announcement not found.");
      if (notification.status !== "DRAFT") throw new AppError(409, "CONFLICT", "Only draft announcements can be published.");
      const updated = await prisma.notification.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      await fanOut(id, notification.audienceRole, "announcements");
      await recordAudit(prisma, actor, { action: "announcement.publish", entityType: "Notification", entityId: id });
      return updated;
    },

    async archiveAnnouncement(actor: Actor, id: string) {
      const notification = await prisma.notification.findFirst({ where: { id, type: "ANNOUNCEMENT" } });
      if (!notification) throw new AppError(404, "NOT_FOUND", "Announcement not found.");
      const updated = await prisma.notification.update({ where: { id }, data: { status: "ARCHIVED" } });
      await recordAudit(prisma, actor, { action: "announcement.archive", entityType: "Notification", entityId: id });
      return updated;
    },

    async listAnnouncements(query: { page: number; pageSize: number }) {
      const where = { type: "ANNOUNCEMENT" as const };
      const [rows, total] = await prisma.$transaction([
        prisma.notification.findMany({
          where,
          include: { _count: { select: { recipients: true } } },
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.notification.count({ where }),
      ]);
      return {
        items: rows.map(({ _count, ...row }) => ({
          id: row.id,
          title: row.title,
          body: row.body,
          audience: row.audience,
          audienceRole: row.audienceRole,
          status: row.status,
          publishedAt: row.publishedAt,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          recipients: _count.recipients,
        })),
        meta: pageMeta(query.page, query.pageSize, total),
      };
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
