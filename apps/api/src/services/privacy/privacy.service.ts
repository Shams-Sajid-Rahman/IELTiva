import type { PrismaClient } from "../../generated/prisma/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { AppError } from "../../utils/app-error.js";
import type { Logger } from "../../utils/logger.js";
import { recordAudit } from "../audit.service.js";
import { verifyPassword } from "../password.service.js";
import type { PrivateStorage } from "../storage/private-storage.js";

const DAY = 86_400_000;
const DEFAULT_CANCEL_DAYS = 14;
const EXPORT_VERSION = 1;

type Deps = {
  prisma: PrismaClient;
  storage: PrivateStorage;
  auth: { revokeAllSessions: (userId: string) => Promise<unknown> };
  logger: Pick<Logger, "warn" | "error" | "info">;
};

/**
 * A student's own control over their data: seeing it, taking a copy, and deleting the account.
 * Payment records stay after deletion with the person's details removed, because accounting rules may
 * require them. How long they must be kept is a question for legal review.
 */
export function createPrivacyService({ prisma, storage, auth, logger }: Deps) {
  async function cancelWindowDays() {
    const setting = await prisma.platformSetting.findUnique({ where: { key: "privacy.deletion_cancel_window_days" } });
    return typeof setting?.value === "number" ? setting.value : DEFAULT_CANCEL_DAYS;
  }

  /** Everything held about one person, in a form they can read. Credentials, session details and internal notes are left out. */
  async function buildExport(userId: string) {
    const [user, consents, enrollments, progress, history, plans, attempts, conversations, purchases, ledger, entitlements, notifications] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true,
          emailVerifiedAt: true,
          createdAt: true,
          lastLoginAt: true,
          termsAcceptedAt: true,
          profile: { omit: { userId: true, avatarStorageKey: true } },
          oauthAccounts: { select: { provider: true, createdAt: true } },
        },
      }),
      prisma.userConsent.findMany({ where: { userId }, select: { type: true, version: true, grantedAt: true, revokedAt: true } }),
      prisma.userEnrollment.findMany({ where: { userId }, select: { status: true, createdAt: true, completedAt: true, course: { select: { title: true } } } }),
      prisma.learningProgress.findMany({ where: { userId }, select: { status: true, percent: true, completedAt: true, resource: { select: { title: true } } } }),
      prisma.userLearningHistory.findMany({ where: { userId }, orderBy: { occurredAt: "desc" }, take: 10_000, select: { eventType: true, minutes: true, occurredAt: true } }),
      prisma.studyPlan.findMany({ where: { userId }, select: { targetBand: true, examDate: true, startsOn: true, endsOn: true, tasks: { select: { title: true, skill: true, scheduledDate: true, completedAt: true } } } }),
      prisma.examAttempt.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          mode: true,
          status: true,
          startedAt: true,
          submittedAt: true,
          rawScore: true,
          maxScore: true,
          overallBand: true,
          examVersion: { select: { exam: { select: { title: true } } } },
          sections: {
            select: {
              status: true,
              rawScore: true,
              maxScore: true,
              bandScore: true,
              section: { select: { title: true, skill: true } },
              responses: { select: { response: true, isCorrect: true, marksAwarded: true, question: { select: { number: true } } } },
              writingSubmissions: { select: { text: true, wordCount: true, submittedAt: true, results: { where: { isCurrent: true }, select: { createdAt: true, feedback: { select: { type: true, body: true } } } } } },
              // The audio itself isn't copied in. It can be played in the app until it's deleted.
              speakingSubmissions: { select: { transcript: true, durationSeconds: true, submittedAt: true, audioDeletedAt: true, fluencyMetrics: true, results: { where: { isCurrent: true }, select: { createdAt: true, feedback: { select: { type: true, body: true } } } } } },
            },
          },
        },
      }),
      prisma.tutorConversation.findMany({ where: { userId }, select: { title: true, createdAt: true, messages: { orderBy: { createdAt: "asc" }, select: { role: true, text: true, createdAt: true } } } }),
      prisma.userPurchase.findMany({ where: { userId }, select: { status: true, currency: true, amountMinor: true, refundedMinor: true, paidAt: true, createdAt: true, packageSnapshot: true, transactions: { select: { trackingId: true, status: true, currency: true, amountMinor: true, succeededAt: true, gateway: { select: { name: true } } } }, refunds: { select: { status: true, amountMinor: true, reason: true, createdAt: true, completedAt: true } } } }),
      prisma.creditLedger.findMany({ where: { userId }, select: { featureKey: true, delta: true, reason: true, createdAt: true } }),
      prisma.userEntitlement.findMany({ where: { userId }, select: { featureKey: true, status: true, creditsGranted: true, creditsUsed: true, startsAt: true, endsAt: true } }),
      prisma.userNotification.findMany({ where: { userId }, take: 1_000, select: { readAt: true, notification: { select: { title: true, body: true, createdAt: true } } } }),
    ]);
    const [feedback, reviews] = await Promise.all([
      prisma.betaFeedback.findMany({ where: { userId }, select: { category: true, message: true, status: true, createdAt: true } }),
      prisma.instructorReview.findMany({ where: { requestedById: userId }, select: { status: true, overallBand: true, criterionBands: true, note: true, requestedAt: true, completedAt: true } }),
    ]);
    return { exportVersion: EXPORT_VERSION, exportedAt: new Date().toISOString(), note: "A copy of the personal data IELTiva holds about you. Sign-in secrets aren't included.", account: user, consents, enrollments, progress, history, studyPlans: plans, examAttempts: attempts, tutorConversations: conversations, purchases, credits: { entitlements, ledger }, notifications, feedback, instructorReviews: reviews };
  }

  async function deleteStoredFiles(userId: string) {
    const [recordings, reports, profile] = await Promise.all([
      prisma.speakingSubmission.findMany({ where: { audioStorageKey: { not: null }, sectionAttempt: { examAttempt: { userId } } }, select: { audioStorageKey: true } }),
      prisma.generatedReport.findMany({ where: { userId, storageKey: { not: null } }, select: { storageKey: true } }),
      prisma.userProfile.findUnique({ where: { userId }, select: { avatarStorageKey: true } }),
    ]);
    const keys = [...recordings.map((row) => row.audioStorageKey), ...reports.map((row) => row.storageKey), profile?.avatarStorageKey].filter((key): key is string => Boolean(key));
    // If any file can't be removed, this throws and the whole account is tried again next run, so no file is left behind untracked.
    for (const key of keys) await storage.delete(key);
    return keys.length;
  }

  /** Removes the person from every table, and keeps financial rows with no way to identify them. */
  async function eraseAccount(userId: string) {
    const files = await deleteStoredFiles(userId);
    const { email } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    await prisma.$transaction(
      async (tx) => {
        await tx.aIAssessmentJob.deleteMany({ where: { userId } });
        await tx.examAttempt.deleteMany({ where: { userId } });
        await tx.tutorConversation.deleteMany({ where: { userId } });
        // Feedback is free text and can name the person, and the allow list holds their address.
        await tx.betaFeedback.deleteMany({ where: { userId } });
        await tx.betaAccess.deleteMany({ where: { email } });
        await tx.userConsent.deleteMany({ where: { userId } });
        await tx.userEnrollment.deleteMany({ where: { userId } });
        await tx.learningProgress.deleteMany({ where: { userId } });
        await tx.userLearningHistory.deleteMany({ where: { userId } });
        await tx.studyPlan.deleteMany({ where: { userId } });
        await tx.generatedReport.deleteMany({ where: { userId } });
        await tx.creditLedger.deleteMany({ where: { userId } });
        await tx.userEntitlement.deleteMany({ where: { userId } });
        await tx.userNotification.deleteMany({ where: { userId } });
        await tx.refreshToken.deleteMany({ where: { userId } });
        await tx.userSession.deleteMany({ where: { userId } });
        await tx.emailVerificationToken.deleteMany({ where: { userId } });
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.oAuthAccount.deleteMany({ where: { userId } });
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userProfile.deleteMany({ where: { userId } });
        await tx.aIUsageLog.updateMany({ where: { userId }, data: { userId: null } });
        // A refund reason is free text and could name the person.
        await tx.refundRecord.updateMany({ where: { purchase: { userId } }, data: { reason: null, decisionNote: null } });
        // Audit entries stay, because they show what happened. The personal details inside them are cleared, whoever made the entry.
        await tx.auditLog.updateMany({ where: { OR: [{ actorId: userId }, { entityType: "user", entityId: userId }] }, data: { ipAddress: null, before: Prisma.JsonNull, after: Prisma.JsonNull } });
        await tx.user.update({
          where: { id: userId },
          data: { email: `deleted-${userId}@deleted.invalid`, passwordHash: null, status: "DELETED", deletedAt: new Date(), deletionRequestedAt: null, deletionScheduledAt: null, emailVerifiedAt: null, lastLoginAt: null, termsAcceptedAt: null, failedLoginAttempts: 0, lockedUntil: null },
        });
        await recordAudit(tx, null, { action: "privacy.account_deleted", entityType: "user", entityId: userId, after: { files } });
      },
      { timeout: 60_000 },
    );
  }

  return {
    buildExport,

    /** The privacy page: what's scheduled and how long things are kept. */
    async summary(actor: Actor) {
      const [user, settings] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { deletionRequestedAt: true, deletionScheduledAt: true, passwordHash: true } }),
        prisma.platformSetting.findMany({ where: { key: { in: ["retention.speaking_recordings_days", "retention.data_exports_days", "privacy.deletion_cancel_window_days"] } } }),
      ]);
      const value = (key: string, fallback: number) => {
        const found = settings.find((row) => row.key === key)?.value;
        return typeof found === "number" ? found : fallback;
      };
      return {
        deletion: user.deletionScheduledAt ? { requestedAt: user.deletionRequestedAt, scheduledFor: user.deletionScheduledAt } : null,
        hasPassword: Boolean(user.passwordHash),
        retention: { recordingsDays: value("retention.speaking_recordings_days", 90), exportsDays: value("retention.data_exports_days", 7), cancelWindowDays: value("privacy.deletion_cancel_window_days", DEFAULT_CANCEL_DAYS) },
      };
    },

    /** Schedules the deletion. The student stays signed in and can change their mind until the date. */
    async requestDeletion(actor: Actor, input: { password?: string | undefined; confirmation: string }) {
      if (input.confirmation !== "DELETE") throw new AppError(400, "VALIDATION_ERROR", "Type DELETE to confirm.");
      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { passwordHash: true, deletionScheduledAt: true } });
      if (user.deletionScheduledAt) throw new AppError(409, "CONFLICT", "Your account is already scheduled for deletion.");
      // A borrowed, signed-in browser mustn't be enough on its own to delete an account.
      if (user.passwordHash && !(await verifyPassword(user.passwordHash, input.password ?? ""))) throw new AppError(403, "FORBIDDEN", "That password isn't right.");
      // Staff accounts own content and history, so another administrator has to remove them.
      if (actor.roles.some((role) => role !== "STUDENT")) throw new AppError(409, "CONFLICT", "Staff accounts need to be removed by an administrator.");
      const now = new Date();
      const scheduledFor = new Date(now.getTime() + (await cancelWindowDays()) * DAY);
      await prisma.user.update({ where: { id: actor.userId }, data: { deletionRequestedAt: now, deletionScheduledAt: scheduledFor } });
      await recordAudit(prisma, actor, { action: "privacy.deletion_requested", entityType: "user", entityId: actor.userId, after: { scheduledFor } });
      return { scheduledFor };
    },

    async cancelDeletion(actor: Actor) {
      const changed = await prisma.user.updateMany({ where: { id: actor.userId, deletionScheduledAt: { gt: new Date() } }, data: { deletionRequestedAt: null, deletionScheduledAt: null } });
      if (changed.count !== 1) throw new AppError(409, "CONFLICT", "There's no deletion to cancel.");
      await recordAudit(prisma, actor, { action: "privacy.deletion_canceled", entityType: "user", entityId: actor.userId });
    },

    /** Run by the worker. One account failing doesn't stop the others, and it's simply tried again next time. */
    async processDueDeletions() {
      const due = await prisma.user.findMany({ where: { deletionScheduledAt: { lte: new Date() }, status: { not: "DELETED" } }, select: { id: true }, take: 50 });
      let deleted = 0;
      for (const row of due) {
        try {
          await auth.revokeAllSessions(row.id);
          await eraseAccount(row.id);
          deleted += 1;
        } catch (error) {
          logger.error({ err: error, userId: row.id }, "Account deletion failed and will be retried");
        }
      }
      return deleted;
    },
  };
}

export type PrivacyService = ReturnType<typeof createPrivacyService>;
