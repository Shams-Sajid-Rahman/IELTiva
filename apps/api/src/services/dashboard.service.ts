import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { Actor } from "../types/platform.js";
import { AppError } from "../utils/app-error.js";
import { courseProgress } from "./course-access.js";
import type { NotificationService } from "./notification.service.js";

const DAY = 86_400_000;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dayInZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Counts consecutive days with recorded activity, ending today or yesterday in the student's timezone. */
export function calculateStreak(days: string[], today: string) {
  const seen = new Set(days);
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!seen.has(today)) cursor.setTime(cursor.getTime() - DAY);
  let streak = 0;
  while (seen.has(isoDate(cursor))) {
    streak += 1;
    cursor.setTime(cursor.getTime() - DAY);
  }
  return streak;
}

export function createDashboardService(prisma: PrismaClient, notifications: NotificationService) {
  return {
    async student(actor: Actor) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: {
          email: true,
          emailVerifiedAt: true,
          createdAt: true,
          profile: { select: { firstName: true, lastName: true, examType: true, targetBand: true, examDate: true, timezone: true } },
        },
      });
      const timeZone = user.profile?.timezone ?? "UTC";
      const today = dayInZone(new Date(), timeZone);

      const [enrollments, completedActivities, minutes, dayRows, recentActivity, tasks, unread] = await Promise.all([
        prisma.userEnrollment.findMany({
          where: { userId: actor.userId, status: { not: "CANCELED" }, course: { deletedAt: null } },
          orderBy: [{ lastAccessedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          select: {
            id: true,
            courseId: true,
            status: true,
            lastAccessedAt: true,
            lastResource: { select: { id: true, title: true } },
            course: { select: { title: true, thumbnailUrl: true, module: { select: { name: true } } } },
          },
        }),
        prisma.learningProgress.count({ where: { userId: actor.userId, status: "COMPLETED" } }),
        prisma.userLearningHistory.aggregate({ where: { userId: actor.userId }, _sum: { minutes: true } }),
        prisma.$queryRaw<{ day: string }[]>`
          SELECT DISTINCT to_char(occurred_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day
          FROM user_learning_history WHERE user_id = ${actor.userId}::uuid ORDER BY day DESC LIMIT 400`,
        prisma.userLearningHistory.findMany({
          where: { userId: actor.userId },
          orderBy: { occurredAt: "desc" },
          take: 8,
          select: { id: true, eventType: true, occurredAt: true, course: { select: { id: true, title: true } }, resource: { select: { id: true, title: true } } },
        }),
        prisma.studyPlanTask.findMany({
          where: { completedAt: null, plan: { userId: actor.userId, isActive: true } },
          orderBy: { scheduledDate: "asc" },
          take: 5,
          select: { id: true, title: true, skill: true, scheduledDate: true, estimatedMinutes: true },
        }),
        notifications.unreadCount(actor.userId),
      ]);

      const progress = await courseProgress(prisma, actor.userId, enrollments.map((row) => row.courseId));
      const totals = [...progress.values()].reduce((sum, row) => ({ total: sum.total + row.total, completed: sum.completed + row.completed }), { total: 0, completed: 0 });
      const enrolledIds = enrollments.map((row) => row.courseId);
      const recommended = await prisma.course.findMany({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
          id: { notIn: enrolledIds },
          ...(user.profile?.examType ? { OR: [{ examType: user.profile.examType }, { examType: null }] } : {}),
        },
        orderBy: { publishedAt: "desc" },
        take: 3,
        select: { id: true, title: true, description: true, difficulty: true, estimatedMinutes: true, isPremium: true, module: { select: { name: true } } },
      });

      // A reminder comes from a real overdue or due task, at most once per day.
      const due = tasks.filter((task) => isoDate(task.scheduledDate) <= today);
      if (due.length) {
        await notifications.notifyUser(actor.userId, {
          type: "LEARNING",
          title: "Study tasks due",
          body: due.length === 1 ? `"${due[0]!.title}" is due.` : `You have ${due.length} study tasks due.`,
          link: "/planner",
          dedupeKey: `task-reminder:${actor.userId}:${today}`,
          preference: "learning",
        });
      }

      return {
        profile: {
          firstName: user.profile?.firstName ?? "",
          lastName: user.profile?.lastName ?? "",
          email: user.email,
          emailVerified: user.emailVerifiedAt !== null,
          examType: user.profile?.examType ?? null,
          targetBand: user.profile?.targetBand ? Number(user.profile.targetBand) : null,
          examDate: user.profile?.examDate ?? null,
          memberSince: user.createdAt,
        },
        stats: {
          overallPercent: totals.total ? Math.round((totals.completed / totals.total) * 100) : 0,
          completedActivities,
          loggedMinutes: minutes._sum.minutes ?? 0,
          streakDays: calculateStreak(dayRows.map((row) => row.day), today),
          enrolledCourses: enrollments.length,
          unreadNotifications: unread,
        },
        enrollments: enrollments.slice(0, 4).map((row) => ({
          id: row.id,
          courseId: row.courseId,
          status: row.status,
          lastAccessedAt: row.lastAccessedAt,
          lastResource: row.lastResource,
          title: row.course.title,
          moduleName: row.course.module.name,
          progress: progress.get(row.courseId)!,
        })),
        recentActivity,
        upcomingTasks: tasks,
        recommended,
      };
    },

    async admin(actor: Actor) {
      const now = Date.now();
      const since = new Date(now - 30 * DAY);
      const countRole = (code: string) => prisma.userRole.count({ where: { role: { code }, user: { deletedAt: null } } });
      const [totalUsers, activeUsers, newUsers, students, instructors, courses, publishedCourses, modules, publishedModules, enrollments] = await Promise.all([
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.user.count({ where: { deletedAt: null, status: "ACTIVE", lastLoginAt: { gte: since } } }),
        prisma.user.count({ where: { deletedAt: null, createdAt: { gte: since } } }),
        countRole("STUDENT"),
        countRole("INSTRUCTOR"),
        prisma.course.count({ where: { deletedAt: null } }),
        prisma.course.count({ where: { deletedAt: null, status: "PUBLISHED" } }),
        prisma.learningModule.count(),
        prisma.learningModule.count({ where: { status: "PUBLISHED" } }),
        prisma.userEnrollment.count({ where: { status: { not: "CANCELED" } } }),
      ]);
      const canSeeUsers = actor.permissions.includes("users.read");
      const name = { profile: { select: { firstName: true, lastName: true } } };
      const [recentUsers, recentPublications, recentEnrollments, recentActions] = await Promise.all([
        canSeeUsers ? prisma.user.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, email: true, createdAt: true, ...name } }) : [],
        prisma.contentPublicationHistory.findMany({
          where: { action: "PUBLISHED" },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, createdAt: true, course: { select: { id: true, title: true } }, learningModule: { select: { id: true, name: true } }, actor: { select: name } },
        }),
        actor.permissions.includes("enrollments.read")
          ? prisma.userEnrollment.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, status: true, createdAt: true, course: { select: { title: true } }, user: { select: name } } })
          : [],
        actor.permissions.includes("audit.read")
          ? prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, action: true, entityType: true, createdAt: true, actor: { select: name } } })
          : [],
      ]);
      return {
        metrics: { totalUsers, activeUsers, newUsers, students, instructors, courses, publishedCourses, modules, publishedModules, enrollments },
        activity: { recentUsers, recentPublications, recentEnrollments, recentActions },
      };
    },

    /** Real aggregates from PostgreSQL, using UTC days. Days without activity appear as zero. */
    async analytics(query: { from?: string | undefined; to?: string | undefined }) {
      const to = query.to ?? isoDate(new Date());
      const from = query.from ?? isoDate(new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * DAY));
      const span = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY;
      if (Number.isNaN(span) || span < 0) throw new AppError(400, "VALIDATION_ERROR", "The start date must be before the end date.");
      if (span > 366) throw new AppError(400, "VALIDATION_ERROR", "Choose a range of one year or less.");

      const series = (rows: { day: string; count: number }[]) => rows.map((row) => ({ day: row.day, count: Number(row.count) }));
      const [registrations, enrollments, activity, popularity] = await Promise.all([
        prisma.$queryRaw<{ day: string; count: number }[]>(Prisma.sql`
          SELECT to_char(d, 'YYYY-MM-DD') AS day, count(u.id)::int AS count
          FROM generate_series(${from}::date, ${to}::date, interval '1 day') d
          LEFT JOIN users u ON (u.created_at AT TIME ZONE 'UTC')::date = d::date
          GROUP BY d ORDER BY d`),
        prisma.$queryRaw<{ day: string; count: number }[]>(Prisma.sql`
          SELECT to_char(d, 'YYYY-MM-DD') AS day, count(e.id)::int AS count
          FROM generate_series(${from}::date, ${to}::date, interval '1 day') d
          LEFT JOIN user_enrollments e ON (e.created_at AT TIME ZONE 'UTC')::date = d::date
          GROUP BY d ORDER BY d`),
        prisma.$queryRaw<{ day: string; count: number }[]>(Prisma.sql`
          SELECT to_char(d, 'YYYY-MM-DD') AS day, count(h.id)::int AS count
          FROM generate_series(${from}::date, ${to}::date, interval '1 day') d
          LEFT JOIN user_learning_history h ON (h.occurred_at AT TIME ZONE 'UTC')::date = d::date
          GROUP BY d ORDER BY d`),
        prisma.$queryRaw<{ title: string; count: number }[]>(Prisma.sql`
          SELECT c.title, count(e.id)::int AS count
          FROM courses c JOIN user_enrollments e ON e.course_id = c.id AND e.status <> 'CANCELED'
          WHERE c.deleted_at IS NULL
          GROUP BY c.id, c.title ORDER BY count DESC, c.title ASC LIMIT 8`),
      ]);
      return {
        from,
        to,
        registrations: series(registrations),
        enrollments: series(enrollments),
        activity: series(activity),
        coursePopularity: popularity.map((row) => ({ title: row.title, count: Number(row.count) })),
      };
    },
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
