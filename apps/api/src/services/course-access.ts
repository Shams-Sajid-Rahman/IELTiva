import type { Actor, Db } from "../types/platform.js";
import { PREMIUM_FEATURES } from "./billing/entitlement.service.js";

export const canManageAllCourses = (actor: Actor) => actor.permissions.includes("courses.manage_all");
export const canAuthorCourses = (actor: Actor) => canManageAllCourses(actor) || actor.permissions.includes("courses.manage");

export function canManageCourse(actor: Actor, course: { instructorId: string | null }) {
  return canManageAllCourses(actor) || (actor.permissions.includes("courses.manage") && course.instructorId === actor.userId);
}

/** Premium content opens for anyone with an active pass or an active practice package. */
export async function hasPremiumAccess(db: Db, userId: string) {
  const count = await db.userEntitlement.count({
    where: { userId, featureKey: { in: [...PREMIUM_FEATURES] }, status: "ACTIVE", startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
  });
  return count > 0;
}

export const visibleResourceWhere = {
  deletedAt: null,
  section: { isVisible: true, archivedAt: null },
} as const;

/** Real progress per course, counted from stored records and only for content students can currently see. */
export async function courseProgress(db: Db, userId: string, courseIds: string[]) {
  const result = new Map<string, { total: number; completed: number; percent: number }>();
  if (courseIds.length === 0) return result;
  const resources = await db.learningResource.findMany({
    where: { ...visibleResourceWhere, section: { ...visibleResourceWhere.section, courseId: { in: courseIds } } },
    select: { id: true, section: { select: { courseId: true } } },
  });
  const completed = new Set(
    (
      await db.learningProgress.findMany({
        where: { userId, status: "COMPLETED", resourceId: { in: resources.map((r) => r.id) } },
        select: { resourceId: true },
      })
    ).map((row) => row.resourceId),
  );
  for (const id of courseIds) result.set(id, { total: 0, completed: 0, percent: 0 });
  for (const resource of resources) {
    const entry = result.get(resource.section.courseId)!;
    entry.total += 1;
    if (completed.has(resource.id)) entry.completed += 1;
  }
  for (const entry of result.values()) entry.percent = entry.total ? Math.round((entry.completed / entry.total) * 100) : 0;
  return result;
}
