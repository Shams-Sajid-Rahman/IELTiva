import type { PrismaClient, Skill } from "../generated/prisma/client.js";
import type { Actor } from "../types/platform.js";
import { AppError } from "../utils/app-error.js";

const NOT_FOUND = () => new AppError(404, "NOT_FOUND", "Task not found.");

/** Tasks the student writes themselves. AI-generated plans belong to a later phase. */
export function createPlannerService(prisma: PrismaClient) {
  async function activePlan(userId: string) {
    const plan = await prisma.studyPlan.findFirst({ where: { userId, isActive: true } });
    if (plan) return plan;
    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { examDate: true, targetBand: true } });
    const today = new Date(new Date().toISOString().slice(0, 10));
    return prisma.studyPlan.create({
      data: { userId, startsOn: today, endsOn: profile?.examDate ?? new Date(today.getTime() + 90 * 86_400_000), examDate: profile?.examDate ?? null, targetBand: profile?.targetBand ?? null },
    });
  }

  async function ownedTask(userId: string, id: string) {
    const task = await prisma.studyPlanTask.findFirst({ where: { id, plan: { userId } } });
    if (!task) throw NOT_FOUND();
    return task;
  }

  const taskSelect = { id: true, title: true, skill: true, scheduledDate: true, estimatedMinutes: true, completedAt: true } as const;

  return {
    list(actor: Actor) {
      return prisma.studyPlanTask.findMany({
        where: { plan: { userId: actor.userId, isActive: true } },
        orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { scheduledDate: "asc" }],
        take: 200,
        select: taskSelect,
      });
    },

    async create(actor: Actor, input: { title: string; scheduledDate: string; skill?: Skill | null | undefined; estimatedMinutes?: number | null | undefined }) {
      const plan = await activePlan(actor.userId);
      return prisma.studyPlanTask.create({ data: { ...input, planId: plan.id, scheduledDate: new Date(input.scheduledDate) }, select: taskSelect });
    },

    async setCompleted(actor: Actor, id: string, completed: boolean) {
      await ownedTask(actor.userId, id);
      return prisma.studyPlanTask.update({ where: { id }, data: { completedAt: completed ? new Date() : null }, select: taskSelect });
    },

    async remove(actor: Actor, id: string) {
      await ownedTask(actor.userId, id);
      await prisma.studyPlanTask.delete({ where: { id } });
    },
  };
}

export type PlannerService = ReturnType<typeof createPlannerService>;
