import { Prisma, type EnrollmentStatus, type PrismaClient } from "../generated/prisma/client.js";
import type { Actor } from "../types/platform.js";
import { pageMeta } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";
import { recordAudit } from "./audit.service.js";
import { canManageCourse, courseProgress, hasPremiumAccess, visibleResourceWhere } from "./course-access.js";
import type { NotificationService } from "./notification.service.js";

const courseSummary = { id: true, title: true, slug: true, status: true, thumbnailUrl: true, difficulty: true, estimatedMinutes: true, module: { select: { name: true, skill: true } } } as const;

export function createEnrollmentService(prisma: PrismaClient, notifications: NotificationService) {
  async function withProgress<T extends { courseId: string }>(userId: string, rows: T[]) {
    const progress = await courseProgress(prisma, userId, rows.map((row) => row.courseId));
    return rows.map((row) => ({ ...row, progress: progress.get(row.courseId)! }));
  }

  function logHistory(userId: string, eventType: string, data: { courseId?: string; resourceId?: string; minutes?: number; metadata?: Prisma.InputJsonValue }) {
    return prisma.userLearningHistory.create({ data: { userId, eventType, ...data } });
  }

  return {
    async enroll(actor: Actor, courseId: string) {
      const course = await prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
      if (!course || course.status !== "PUBLISHED") throw new AppError(404, "NOT_FOUND", "This course isn't available.");
      if (course.isPremium && !canManageCourse(actor, course) && !(await hasPremiumAccess(prisma, actor.userId))) {
        throw new AppError(403, "ENTITLEMENT_REQUIRED", "This course needs a practice pass, which isn't available to buy yet.");
      }
      const existing = await prisma.userEnrollment.findUnique({ where: { userId_courseId: { userId: actor.userId, courseId } } });
      if (existing && existing.status !== "CANCELED") throw new AppError(409, "CONFLICT", "You're already enrolled in this course.");
      let enrollment;
      try {
        enrollment = existing
          ? await prisma.userEnrollment.update({ where: { id: existing.id }, data: { status: "ACTIVE" } })
          : await prisma.userEnrollment.create({ data: { userId: actor.userId, courseId } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError(409, "CONFLICT", "You're already enrolled in this course.");
        throw error;
      }
      await logHistory(actor.userId, "ENROLLED", { courseId });
      await notifications.notifyUser(actor.userId, {
        type: "LEARNING",
        title: "Enrollment confirmed",
        body: `You're enrolled in "${course.title}".`,
        link: `/courses/${courseId}`,
        preference: "learning",
      });
      return enrollment;
    },

    async listMine(actor: Actor, query: { page: number; pageSize: number }) {
      const where = { userId: actor.userId, course: { deletedAt: null } };
      const [rows, total] = await prisma.$transaction([
        prisma.userEnrollment.findMany({
          where,
          orderBy: [{ lastAccessedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { id: true, courseId: true, status: true, createdAt: true, completedAt: true, lastAccessedAt: true, lastResourceId: true, course: { select: courseSummary } },
        }),
        prisma.userEnrollment.count({ where }),
      ]);
      return { items: await withProgress(actor.userId, rows), meta: pageMeta(query.page, query.pageSize, total) };
    },

    async listAll(query: { page: number; pageSize: number; search?: string | undefined; status?: EnrollmentStatus | undefined; courseId?: string | undefined }) {
      const where: Prisma.UserEnrollmentWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.courseId ? { courseId: query.courseId } : {}),
        ...(query.search
          ? {
              OR: [
                { user: { email: { contains: query.search, mode: "insensitive" as const } } },
                { course: { title: { contains: query.search, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await prisma.$transaction([
        prisma.userEnrollment.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            status: true,
            createdAt: true,
            completedAt: true,
            course: { select: { id: true, title: true } },
            user: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
          },
        }),
        prisma.userEnrollment.count({ where }),
      ]);
      return { items: rows, meta: pageMeta(query.page, query.pageSize, total) };
    },

    async get(actor: Actor, id: string) {
      const row = await prisma.userEnrollment.findUnique({
        where: { id },
        select: { id: true, userId: true, courseId: true, status: true, createdAt: true, completedAt: true, lastAccessedAt: true, lastResourceId: true, course: { select: courseSummary } },
      });
      // A 404 rather than a 403, so students can't discover which enrollments exist.
      if (!row || (row.userId !== actor.userId && !actor.permissions.includes("enrollments.read"))) throw new AppError(404, "NOT_FOUND", "Enrollment not found.");
      const [withStats] = await withProgress(row.userId, [row]);
      return withStats!;
    },

    async setStatus(actor: Actor, id: string, status: "ACTIVE" | "CANCELED") {
      const row = await prisma.userEnrollment.findUnique({ where: { id }, include: { course: { select: { title: true } } } });
      const manager = actor.permissions.includes("enrollments.manage");
      if (!row || (row.userId !== actor.userId && !manager)) throw new AppError(404, "NOT_FOUND", "Enrollment not found.");
      if (row.userId === actor.userId && !manager && status !== "CANCELED") throw new AppError(403, "FORBIDDEN", "Enroll again from the course page.");
      const updated = await prisma.userEnrollment.update({ where: { id }, data: { status } });
      await prisma.userLearningHistory.create({ data: { userId: row.userId, courseId: row.courseId, eventType: status === "CANCELED" ? "ENROLLMENT_CANCELED" : "ENROLLED" } });
      if (row.userId !== actor.userId) {
        await recordAudit(prisma, actor, { action: "enrollment.status", entityType: "UserEnrollment", entityId: id, before: { status: row.status }, after: { status } });
        await notifications.notifyUser(row.userId, {
          type: "LEARNING",
          title: status === "CANCELED" ? "Enrollment canceled" : "Enrollment restored",
          body: `An administrator changed your enrollment in "${row.course.title}".`,
          link: "/learning",
        });
      }
      return updated;
    },

    async recordProgress(actor: Actor, input: { resourceId: string; status: "IN_PROGRESS" | "COMPLETED"; minutesSpent?: number | undefined }) {
      const resource = await prisma.learningResource.findFirst({
        where: { id: input.resourceId, ...visibleResourceWhere },
        select: { id: true, section: { select: { courseId: true, course: { select: { title: true, status: true } } } } },
      });
      if (!resource) throw new AppError(404, "NOT_FOUND", "Resource not found.");
      const courseId = resource.section.courseId;
      const enrollment = await prisma.userEnrollment.findUnique({ where: { userId_courseId: { userId: actor.userId, courseId } } });
      if (!enrollment || enrollment.status === "CANCELED") throw new AppError(403, "FORBIDDEN", "Enroll in this course to record progress.");

      const now = new Date();
      const existing = await prisma.learningProgress.findUnique({ where: { userId_resourceId: { userId: actor.userId, resourceId: input.resourceId } } });
      const finishing = input.status === "COMPLETED" && existing?.status !== "COMPLETED";
      // Opening a finished lesson again doesn't undo its completion.
      const status = existing?.status === "COMPLETED" ? "COMPLETED" : input.status;

      await prisma.$transaction([
        prisma.learningProgress.upsert({
          where: { userId_resourceId: { userId: actor.userId, resourceId: input.resourceId } },
          create: { userId: actor.userId, resourceId: input.resourceId, status, percent: status === "COMPLETED" ? 100 : 0, completedAt: status === "COMPLETED" ? now : null, lastAccessedAt: now },
          update: { status, lastAccessedAt: now, ...(finishing ? { percent: 100, completedAt: now } : {}) },
        }),
        prisma.userEnrollment.update({ where: { id: enrollment.id }, data: { lastAccessedAt: now, lastResourceId: input.resourceId } }),
        prisma.userLearningHistory.create({
          data: { userId: actor.userId, courseId, resourceId: input.resourceId, eventType: finishing ? "RESOURCE_COMPLETED" : "RESOURCE_OPENED", minutes: input.minutesSpent ?? null },
        }),
      ]);

      const progress = (await courseProgress(prisma, actor.userId, [courseId])).get(courseId)!;
      let courseCompleted = false;
      if (progress.total > 0 && progress.completed === progress.total && enrollment.status !== "COMPLETED") {
        courseCompleted = true;
        await prisma.$transaction([
          prisma.userEnrollment.update({ where: { id: enrollment.id }, data: { status: "COMPLETED", completedAt: now } }),
          prisma.userLearningHistory.create({ data: { userId: actor.userId, courseId, eventType: "COURSE_COMPLETED" } }),
        ]);
        await notifications.notifyUser(actor.userId, {
          type: "LEARNING",
          title: "Course completed",
          body: `You finished "${resource.section.course.title}".`,
          link: `/courses/${courseId}`,
          preference: "learning",
        });
      }
      return { status, progress, courseCompleted };
    },

    async progressMine(actor: Actor) {
      const rows = await prisma.userEnrollment.findMany({
        where: { userId: actor.userId, status: { not: "CANCELED" }, course: { deletedAt: null } },
        select: { courseId: true, status: true, lastAccessedAt: true, lastResourceId: true, course: { select: { title: true } } },
      });
      return withProgress(actor.userId, rows);
    },

    async history(actor: Actor, query: { page: number; pageSize: number }) {
      const where = { userId: actor.userId };
      const [rows, total] = await prisma.$transaction([
        prisma.userLearningHistory.findMany({
          where,
          orderBy: { occurredAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { id: true, eventType: true, minutes: true, occurredAt: true, course: { select: { id: true, title: true } }, resource: { select: { id: true, title: true } } },
        }),
        prisma.userLearningHistory.count({ where }),
      ]);
      return { items: rows, meta: pageMeta(query.page, query.pageSize, total) };
    },
  };
}

export type EnrollmentService = ReturnType<typeof createEnrollmentService>;
