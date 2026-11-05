import type { z } from "zod";
import type { learningGoalsSchema } from "@ieltiva/shared";
import type { PrismaClient, Skill } from "../../generated/prisma/client.js";
import type { Actor } from "../../types/platform.js";
import { AppError } from "../../utils/app-error.js";
import type { AiService } from "../ai/ai.service.js";
import { CONSENT_VERSION } from "../ai/assessment.service.js";
import { buildRecommendations, suggestSchedule, type CatalogExam } from "./recommendations.js";
import { dayInZone, type StudentAnalyticsService } from "./student.service.js";

const DAY = 86_400_000;

type Goals = z.infer<typeof learningGoalsSchema>;
type Notify = (userId: string, message: { type: "LEARNING"; title: string; body: string; link?: string; dedupeKey?: string }) => Promise<void>;

/** Goals, goal tracking, recommendations and the suggested study schedule. */
export function createLearningService({ prisma, analytics, ai, notify }: { prisma: PrismaClient; analytics: StudentAnalyticsService; ai: AiService; notify: Notify }) {
  async function profileOf(userId: string) {
    return prisma.userProfile.findUnique({
      where: { userId },
      select: { targetBand: true, examDate: true, dailyGoalMinutes: true, weeklySessionGoal: true, weeklyStudyHours: true, remindersEnabled: true, reminderTime: true, reminderDays: true, timezone: true, examType: true },
    });
  }

  /** Published exams the student could take, and whether they've already taken each. */
  async function catalog(userId: string, examType: "ACADEMIC" | "GENERAL_TRAINING" | null | undefined): Promise<CatalogExam[]> {
    const rows = await prisma.exam.findMany({
      where: { deletedAt: null, versions: { some: { status: "PUBLISHED" } }, ...(examType ? { OR: [{ examType }, { examType: null }] } : {}) },
      take: 200,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        isMock: true,
        isPremium: true,
        versions: { where: { status: "PUBLISHED" }, orderBy: { versionNumber: "desc" }, take: 1, select: { sections: { select: { skill: true } }, attempts: { where: { userId, status: { not: "ABANDONED" } }, select: { id: true }, take: 1 } } },
      },
    });
    return rows.map((row) => ({ id: row.id, title: row.title, isMock: row.isMock, isPremium: row.isPremium, skills: [...new Set(row.versions[0]?.sections.map((section) => section.skill) ?? [])], attempted: (row.versions[0]?.attempts.length ?? 0) > 0 }));
  }

  async function recommendationsFor(actor: Actor) {
    const profile = await profileOf(actor.userId);
    const [data, exams, recent, mocks, vocabularyCourse, grammarCourse] = await Promise.all([
      analytics.overview(actor, 90),
      catalog(actor.userId, profile?.examType),
      analytics.overview(actor, 14),
      prisma.examAttempt.count({ where: { userId: actor.userId, mode: "MOCK", status: { not: "ABANDONED" }, createdAt: { gte: new Date(Date.now() - 30 * DAY) } } }),
      prisma.course.findFirst({ where: { status: "PUBLISHED", deletedAt: null, title: { contains: "vocabulary", mode: "insensitive" } }, select: { id: true, title: true } }),
      prisma.course.findFirst({ where: { status: "PUBLISHED", deletedAt: null, title: { contains: "grammar", mode: "insensitive" } }, select: { id: true, title: true } }),
    ]);
    return buildRecommendations({ analytics: data, recentActiveDays: recent.overview.activeDays, mocksLast30Days: mocks, catalog: exams, vocabularyCourse, grammarCourse });
  }

  async function planFor(actor: Actor, days: number) {
    const profile = await profileOf(actor.userId);
    const [data, exams] = await Promise.all([analytics.overview(actor, 90), catalog(actor.userId, profile?.examType)]);
    const startDate = dayInZone(new Date(), profile?.timezone ?? "UTC");
    return suggestSchedule({ analytics: data, dailyMinutes: profile?.dailyGoalMinutes ?? null, weeklyHours: profile?.weeklyStudyHours ?? null, startDate, days, catalog: exams });
  }

  return {
    /** Goals and how far along each one is, counted from real activity. A goal that isn't set has no progress to report. */
    async goals(actor: Actor) {
      const profile = await profileOf(actor.userId);
      const timeZone = profile?.timezone ?? "UTC";
      const today = dayInZone(new Date(), timeZone);
      const todayDate = new Date(`${today}T00:00:00Z`);
      // Weeks start on Monday, matching the weekly charts.
      const weekStart = new Date(todayDate.getTime() - ((todayDate.getUTCDay() + 6) % 7) * DAY);
      const data = await analytics.overview(actor, 14);
      const daily = new Map(data.activity.map((row) => [row.day, row]));
      let weekMinutes = 0;
      let weekSessions = 0;
      for (let index = 0; index < 7; index += 1) {
        const row = daily.get(new Date(weekStart.getTime() + index * DAY).toISOString().slice(0, 10));
        weekMinutes += row?.minutes ?? 0;
        weekSessions += row?.sessions ?? 0;
      }
      const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
      const planned = await prisma.studyPlanTask.findMany({ where: { plan: { userId: actor.userId, isActive: true }, scheduledDate: { gte: weekStart, lt: weekEnd } }, select: { completedAt: true } });
      return {
        goals: {
          targetBand: profile?.targetBand ? Number(profile.targetBand) : null,
          examDate: profile?.examDate ? profile.examDate.toISOString().slice(0, 10) : null,
          dailyGoalMinutes: profile?.dailyGoalMinutes ?? null,
          weeklySessionGoal: profile?.weeklySessionGoal ?? null,
          remindersEnabled: profile?.remindersEnabled ?? false,
          reminderTime: profile?.reminderTime ?? null,
          reminderDays: profile?.reminderDays ?? [],
        },
        timeZone,
        progress: {
          todayMinutes: daily.get(today)?.minutes ?? 0,
          weekMinutes,
          weekSessions,
          weekTasks: planned.length,
          weekTasksDone: planned.filter((task) => task.completedAt).length,
        },
      };
    },

    async setGoals(actor: Actor, input: Goals) {
      if (input.remindersEnabled && (!input.reminderTime || input.reminderDays.length === 0)) throw new AppError(400, "VALIDATION_ERROR", "Choose a time and at least one day for reminders.");
      if (input.examDate && new Date(`${input.examDate}T00:00:00Z`).getTime() < Date.now() - DAY) throw new AppError(400, "VALIDATION_ERROR", "Choose an exam date that hasn't passed.");
      const examDate = input.examDate ? new Date(`${input.examDate}T00:00:00Z`) : null;
      const exists = await prisma.userProfile.findUnique({ where: { userId: actor.userId }, select: { userId: true } });
      if (!exists) throw new AppError(409, "CONFLICT", "Please complete your profile first.");
      await prisma.$transaction([
        prisma.userProfile.update({
          where: { userId: actor.userId },
          data: { targetBand: input.targetBand, examDate, dailyGoalMinutes: input.dailyGoalMinutes, weeklySessionGoal: input.weeklySessionGoal, remindersEnabled: input.remindersEnabled, reminderTime: input.reminderTime, reminderDays: [...new Set(input.reminderDays)].sort() },
        }),
        // The active plan follows the goal, so planner dates stay consistent.
        prisma.studyPlan.updateMany({ where: { userId: actor.userId, isActive: true }, data: { targetBand: input.targetBand, examDate } }),
      ]);
      await analytics.invalidate(actor.userId);
      return this.goals(actor);
    },

    recommendations: recommendationsFor,

    /**
     * AI only explains what the rules already decided. It receives the recommendations with their numbers and nothing
     * else about the student, so it has no performance data to invent or embellish.
     */
    async explain(actor: Actor) {
      if (!ai.isConfigured()) throw new AppError(503, "SERVICE_UNAVAILABLE", "AI explanations aren't available yet.");
      const consent = await prisma.userConsent.findFirst({ where: { userId: actor.userId, type: "AI_PROCESSING", revokedAt: null, version: CONSENT_VERSION } });
      if (!consent) throw new AppError(403, "FORBIDDEN", "Please give your consent first.", [{ path: "consent", message: "AI_PROCESSING" }]);
      const items = await recommendationsFor(actor);
      if (items.length === 0) return { text: null };
      const facts = items.map((item) => ({ kind: item.kind, skill: item.skill, evidence: item.evidence, nextStep: item.action.label }));
      const result = await ai.chat("recommendations.explain", [{ role: "user", text: `<recommendations>${JSON.stringify(facts)}</recommendations>` }], { userId: actor.userId, onText: () => {} });
      return { text: result.text };
    },

    suggestPlan: planFor,

    /** Adds the suggested tasks to the student's planner. The plan is worked out again here, and repeating this adds nothing twice. */
    async applyPlan(actor: Actor, days: number) {
      const plan = await planFor(actor, days);
      if (plan.tasks.length === 0) return { added: 0 };
      const profile = await profileOf(actor.userId);
      const today = new Date(`${dayInZone(new Date(), profile?.timezone ?? "UTC")}T00:00:00Z`);
      const active =
        (await prisma.studyPlan.findFirst({ where: { userId: actor.userId, isActive: true } })) ??
        (await prisma.studyPlan.create({ data: { userId: actor.userId, startsOn: today, endsOn: profile?.examDate ?? new Date(today.getTime() + 90 * DAY), examDate: profile?.examDate ?? null, targetBand: profile?.targetBand ?? null } }));
      const existing = await prisma.studyPlanTask.findMany({ where: { planId: active.id, scheduledDate: { gte: today } }, select: { scheduledDate: true, title: true } });
      const taken = new Set(existing.map((row) => `${row.scheduledDate.toISOString().slice(0, 10)}|${row.title}`));
      const fresh = plan.tasks.filter((task) => !taken.has(`${task.date}|${task.title}`));
      await prisma.studyPlanTask.createMany({
        data: fresh.map((task) => ({ planId: active.id, scheduledDate: new Date(`${task.date}T00:00:00Z`), skill: task.skill as Skill | null, title: task.title, estimatedMinutes: task.minutes, description: "Suggested from your practice results" })),
      });
      return { added: fresh.length };
    },

    /** Called by the background worker. Each student gets at most one reminder a day, at their chosen local time, and none once today's goal is met. */
    async sendDueReminders(now = new Date()) {
      const rows = await prisma.userProfile.findMany({ where: { remindersEnabled: true, reminderTime: { not: null }, user: { status: "ACTIVE" } }, select: { userId: true, timezone: true, reminderTime: true, reminderDays: true, dailyGoalMinutes: true }, take: 5_000 });
      let sent = 0;
      for (const row of rows) {
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone: row.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
        const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
        const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
        // The worker runs every 15 minutes, so anything at or before the local time in the last 15 minutes is due.
        const [hour = 0, minute = 0] = (row.reminderTime ?? "").split(":").map(Number);
        const elapsed = Number(value("hour")) * 60 + Number(value("minute")) - (hour * 60 + minute);
        if (elapsed < 0 || elapsed >= 15 || !row.reminderDays.includes(weekday)) continue;

        const today = dayInZone(now, row.timezone);
        const activity = await prisma.userLearningHistory.aggregate({ where: { userId: row.userId, occurredAt: { gte: new Date(now.getTime() - DAY) } }, _sum: { minutes: true } });
        const sections = await prisma.sectionAttempt.aggregate({ where: { examAttempt: { userId: row.userId }, submittedAt: { gte: new Date(now.getTime() - DAY) } }, _sum: { timeSpentSeconds: true } });
        const minutes = (activity._sum.minutes ?? 0) + Math.round((sections._sum.timeSpentSeconds ?? 0) / 60);
        if (row.dailyGoalMinutes && minutes >= row.dailyGoalMinutes) continue;
        await notify(row.userId, {
          type: "LEARNING",
          title: "Time to practice",
          body: row.dailyGoalMinutes ? `Your goal today is ${row.dailyGoalMinutes} minutes. A short session keeps your progress going.` : "A short session today keeps your progress going.",
          link: "/planner",
          dedupeKey: `reminder:${row.userId}:${today}`,
        });
        sent += 1;
      }
      return sent;
    },
  };
}

export type LearningService = ReturnType<typeof createLearningService>;
