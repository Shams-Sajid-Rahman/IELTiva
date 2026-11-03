import { randomBytes } from "node:crypto";
import { defaultNotificationPrefs } from "@ieltiva/shared";
import { Prisma, type ExamType, type PrismaClient, type Skill } from "../generated/prisma/client.js";
import type { Env } from "../config/env.js";
import type { Actor } from "../types/platform.js";
import { AppError } from "../utils/app-error.js";
import { hashToken, randomToken } from "../utils/crypto.js";
import type { Logger } from "../utils/logger.js";
import { recordAudit } from "./audit.service.js";
import type { EmailProvider } from "./email/email.provider.js";
import { readNotificationPrefs, type NotificationService } from "./notification.service.js";
import { hashPassword, verifyPassword } from "./password.service.js";
import { contentTypeForKey, detectImageType, type PrivateStorage } from "./storage/private-storage.js";

const EMAIL_CHANGE_HOURS = 24;
const WRONG_PASSWORD = () => new AppError(400, "VALIDATION_ERROR", "Your current password is incorrect.", [{ path: "currentPassword", message: "Your current password is incorrect." }]);

type Deps = {
  prisma: PrismaClient;
  env: Pick<Env, "FRONTEND_URL">;
  email: EmailProvider;
  logger: Pick<Logger, "error">;
  notifications: NotificationService;
  storage: PrivateStorage;
};

type Preferences = {
  examType?: ExamType | null | undefined;
  targetBand?: number | null | undefined;
  examDate?: string | null | undefined;
  weeklyStudyHours?: number | null | undefined;
  dailyGoalMinutes?: number | null | undefined;
  preferredSkills?: Skill[] | undefined;
  locale?: string | undefined;
  timezone?: string | undefined;
  notificationPrefs?: { learning: boolean; announcements: boolean } | undefined;
};

export function createProfileService({ prisma, env, email, logger, notifications, storage }: Deps) {
  async function me(actor: Actor) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        emailVerifiedAt: true,
        createdAt: true,
        profile: true,
        oauthAccounts: { select: { provider: true } },
        userRoles: { select: { role: { select: { code: true, name: true } } } },
      },
    });
    const { profile } = user;
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt,
      hasPassword: user.passwordHash !== null,
      linkedProviders: user.oauthAccounts.map((account) => account.provider),
      roles: user.userRoles.map(({ role }) => role),
      firstName: profile?.firstName ?? "",
      lastName: profile?.lastName ?? "",
      hasPhoto: Boolean(profile?.avatarStorageKey),
      photoVersion: profile?.updatedAt ?? null,
      locale: profile?.locale ?? "en",
      timezone: profile?.timezone ?? "UTC",
      examType: profile?.examType ?? null,
      targetBand: profile?.targetBand ? Number(profile.targetBand) : null,
      examDate: profile?.examDate ? profile.examDate.toISOString().slice(0, 10) : null,
      weeklyStudyHours: profile?.weeklyStudyHours ?? null,
      dailyGoalMinutes: profile?.dailyGoalMinutes ?? null,
      preferredSkills: profile?.preferredSkills ?? [],
      notificationPrefs: profile ? readNotificationPrefs(profile.notificationPrefs) : defaultNotificationPrefs,
    };
  }

  async function ensureProfile(userId: string) {
    return prisma.userProfile.upsert({ where: { userId }, create: { userId, firstName: "", lastName: "" }, update: {} });
  }

  return {
    me,

    async update(actor: Actor, input: { firstName?: string | undefined; lastName?: string | undefined }) {
      await ensureProfile(actor.userId);
      await prisma.userProfile.update({ where: { userId: actor.userId }, data: input });
      return me(actor);
    },

    async updatePreferences(actor: Actor, input: Preferences) {
      await ensureProfile(actor.userId);
      const { examDate, notificationPrefs, targetBand, ...rest } = input;
      await prisma.userProfile.update({
        where: { userId: actor.userId },
        data: {
          ...rest,
          ...(examDate !== undefined ? { examDate: examDate ? new Date(examDate) : null } : {}),
          ...(targetBand !== undefined ? { targetBand } : {}),
          ...(notificationPrefs ? { notificationPrefs: notificationPrefs as Prisma.InputJsonValue } : {}),
        },
      });
      return me(actor);
    },

    async uploadPhoto(actor: Actor, data: Buffer) {
      const type = detectImageType(data);
      if (!type) throw new AppError(400, "VALIDATION_ERROR", "Use a PNG, JPEG or WebP image.");
      const profile = await ensureProfile(actor.userId);
      const key = `avatars/${actor.userId}/${randomBytes(16).toString("hex")}.${type.extension}`;
      await storage.put(key, data);
      await prisma.userProfile.update({ where: { userId: actor.userId }, data: { avatarStorageKey: key } });
      if (profile.avatarStorageKey) await storage.delete(profile.avatarStorageKey);
      return me(actor);
    },

    async removePhoto(actor: Actor) {
      const profile = await ensureProfile(actor.userId);
      if (profile.avatarStorageKey) {
        await prisma.userProfile.update({ where: { userId: actor.userId }, data: { avatarStorageKey: null } });
        await storage.delete(profile.avatarStorageKey);
      }
      return me(actor);
    },

    async readPhoto(actor: Actor) {
      const profile = await prisma.userProfile.findUnique({ where: { userId: actor.userId }, select: { avatarStorageKey: true } });
      if (!profile?.avatarStorageKey) throw new AppError(404, "NOT_FOUND", "No photo set.");
      const data = await storage.get(profile.avatarStorageKey);
      if (!data) throw new AppError(404, "NOT_FOUND", "No photo set.");
      return { data, contentType: contentTypeForKey(profile.avatarStorageKey) };
    },

    async sessions(actor: Actor) {
      const rows = await prisma.userSession.findMany({
        where: { userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: "desc" },
        select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastSeenAt: true, expiresAt: true },
      });
      return rows.map((row) => ({ ...row, current: row.id === actor.sessionId }));
    },

    async revokeSession(actor: Actor, id: string) {
      const now = new Date();
      const session = await prisma.userSession.findFirst({ where: { id, userId: actor.userId, revokedAt: null } });
      if (!session) throw new AppError(404, "NOT_FOUND", "Session not found.");
      await prisma.$transaction([
        prisma.refreshToken.updateMany({ where: { sessionId: id, revokedAt: null }, data: { revokedAt: now } }),
        prisma.userSession.update({ where: { id }, data: { revokedAt: now } }),
      ]);
      return { current: id === actor.sessionId };
    },

    async revokeOtherSessions(actor: Actor) {
      const now = new Date();
      const [, sessions] = await prisma.$transaction([
        prisma.refreshToken.updateMany({ where: { userId: actor.userId, revokedAt: null, sessionId: { not: actor.sessionId } }, data: { revokedAt: now } }),
        prisma.userSession.updateMany({ where: { userId: actor.userId, revokedAt: null, id: { not: actor.sessionId } }, data: { revokedAt: now } }),
      ]);
      return { revoked: sessions.count };
    },

    async changePassword(actor: Actor, input: { currentPassword: string; newPassword: string }) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { passwordHash: true } });
      if (!user.passwordHash) throw new AppError(400, "VALIDATION_ERROR", "Your account uses Google sign-in. Use Forgot password to set a password.");
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) throw WRONG_PASSWORD();
      const passwordHash = await hashPassword(input.newPassword);
      const now = new Date();
      // This device stays signed in. Every other session ends.
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: actor.userId }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } });
        await tx.refreshToken.updateMany({ where: { userId: actor.userId, revokedAt: null, sessionId: { not: actor.sessionId } }, data: { revokedAt: now } });
        await tx.userSession.updateMany({ where: { userId: actor.userId, revokedAt: null, id: { not: actor.sessionId } }, data: { revokedAt: now } });
        await recordAudit(tx, actor, { action: "user.password_change", entityType: "User", entityId: actor.userId });
      });
      await notifications.notifyUser(actor.userId, { type: "SECURITY", title: "Password changed", body: "Your password was changed, and other devices were signed out." });
    },

    /** The new address must confirm the link. The response never reveals whether it's already registered. */
    async requestEmailChange(actor: Actor, input: { newEmail: string; currentPassword: string }) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true, passwordHash: true } });
      if (!user.passwordHash) throw new AppError(400, "VALIDATION_ERROR", "Your account uses Google sign-in. Use Forgot password to set a password first.");
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) throw WRONG_PASSWORD();
      if (input.newEmail === user.email) throw new AppError(400, "VALIDATION_ERROR", "That's already your email address.", [{ path: "newEmail", message: "That's already your email address." }]);
      if (await prisma.user.count({ where: { email: input.newEmail } })) return;

      const token = randomToken();
      const now = new Date();
      await prisma.$transaction([
        prisma.emailVerificationToken.updateMany({ where: { userId: actor.userId, usedAt: null, newEmail: { not: null } }, data: { usedAt: now } }),
        prisma.emailVerificationToken.create({
          data: { userId: actor.userId, tokenHash: hashToken(token), newEmail: input.newEmail, expiresAt: new Date(now.getTime() + EMAIL_CHANGE_HOURS * 3_600_000) },
        }),
      ]);
      try {
        await email.send({
          to: input.newEmail,
          subject: "Confirm your new IELTiva email",
          text: `Confirm this address using this link:\n\n${env.FRONTEND_URL}/verify-email?token=${token}\n\nIt expires in ${EMAIL_CHANGE_HOURS} hours. If you didn't ask for this, you can ignore this email.`,
        });
      } catch (error) {
        logger.error({ err: error }, "Email change message failed");
      }
      await notifications.notifyUser(actor.userId, { type: "SECURITY", title: "Email change requested", body: "A change of email address was requested. It takes effect only after the new address is confirmed." });
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
